// server.js

const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const session = require('express-session');
const cookieParser = require('cookie-parser'); // <--- ADDED THIS
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
const geoip = require('geoip-lite');
const { getCountryData, countryData } = require('./utils/currencyMap');
require('dotenv').config();

const http = require('http');
const { Server } = require("socket.io");

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 5000;

const server = http.createServer(app);
const io = new Server(server);

// Make io accessible to routes if needed
app.set('io', io);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public')); // Serve static files

// --- ADDED: Cookie Parser (Must be before session) ---
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret')); 

// -- View Engine Setup --
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(ejsLayouts);

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 15 * 60 * 1000 // Session timeout: 15 minutes
    }
}));

// Middleware to set local variables for views
app.use(async (req, res, next) => {
    res.locals.currentUser = req.session.user;
    res.locals.cart = req.session.cart;
    res.locals.path = req.originalUrl; 

    // Determine IP and Country
    const ip = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(req.ip) ? '122.54.69.1' : req.ip; 
    const geo = geoip.lookup(ip);
    const countryCode = req.session.country_override || (geo ? geo.country : 'US');

    res.locals.currentCountryCode = countryCode;
    res.locals.locationData = getCountryData(countryCode);
    res.locals.countryData = countryData;

    // Fetch admin counts only if admin is logged in
    if (req.session.user && req.session.user.role === 'admin') {
        try {
            if (req.app.locals.client && req.app.locals.client.topology && req.app.locals.client.topology.isConnected()) {
                const db = req.app.locals.client.db(req.app.locals.dbName);
                const [newOrderCount, newTicketCount] = await Promise.all([
                    db.collection('orders').countDocuments({ isNew: true }),
                    db.collection('support_tickets').countDocuments({ status: 'Open' })
                ]);
                res.locals.newOrderCount = newOrderCount;
                res.locals.newTicketCount = newTicketCount;
            } else {
                 res.locals.newOrderCount = 0;
                 res.locals.newTicketCount = 0;
            }
        } catch (err) {
            console.error("Error fetching admin counts:", err);
            res.locals.newOrderCount = 0;
            res.locals.newTicketCount = 0;
        }
    } else {
        res.locals.newOrderCount = 0;
        res.locals.newTicketCount = 0;
    }

    next(); 
});

// MongoDB Setup
const uri = process.env.MONGO_URI;
if (!uri) {
    console.error("FATAL ERROR: MONGO_URI environment variable is not set.");
    process.exit(1);
}
const client = new MongoClient(uri);

// Store client and dbName globally
app.locals.client = client;
app.locals.dbName = process.env.DB_NAME || "ecommerceDB";

// Socket.IO Setup for real-time chat
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('joinTicket', (ticketId) => {
        if (ticketId) {
            socket.join(ticketId);
            console.log(`Socket ${socket.id} joined ticket room: ${ticketId}`);
        }
    });

    socket.on('chatMessage', async (data) => {
        if (!data || !data.ticketId || !data.message || !data.sender) {
            return;
        }

        try {
            const db = app.locals.client.db(app.locals.dbName);
            const ticketsCollection = db.collection('support_tickets');

            const newMessage = {
                sender: data.sender, // 'user' or 'admin'
                name: data.name || 'User',
                adminName: data.adminName || null,
                message: data.message.trim(),
                timestamp: new Date()
            };

            const newStatus = data.sender === 'admin' ? 'Answered' : 'Open';

            const updateResult = await ticketsCollection.updateOne(
                { ticketId: data.ticketId },
                {
                    $push: { messages: newMessage },
                    $set: { status: newStatus, updatedAt: new Date() }
                }
            );

            if (updateResult.modifiedCount === 1) {
                io.to(data.ticketId).emit('newMessage', newMessage);
            } 

        } catch (err) {
            console.error('Database error handling chat message:', err);
        }
    });

    socket.on('disconnect', (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
    });
});

// Sitemap Route
app.get('/sitemap.xml', async (req, res, next) => {
    try {
        if (!req.app.locals.client || !req.app.locals.client.topology || !req.app.locals.client.topology.isConnected()) {
             throw new Error("Sitemap generation failed: Database not connected.");
        }

        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const baseUrl = process.env.BASE_URL_LIVE || 'https://www.sneakslab.shop'; 
        const today = new Date().toISOString().split('T')[0];

        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        const staticPages = [
            { loc: '/', priority: '1.00' },
            { loc: '/products', priority: '0.90' },
            { loc: '/about', priority: '0.50' },
            { loc: '/legal', priority: '0.50' },
            { loc: '/users/login', priority: '0.50' },
            { loc: '/users/register', priority: '0.50' },
            { loc: '/password/forgot', priority: '0.50' },
            { loc: '/support', priority: '0.50' },
            { loc: '/products?category=men', priority: '0.80' },
            { loc: '/products?category=women', priority: '0.80' },
            { loc: '/products?new=true', priority: '0.80' },
        ];

        staticPages.forEach(page => {
            xml += `
            <url>
                <loc>${baseUrl}${page.loc}</loc>
                <lastmod>${today}</lastmod>
                <priority>${page.priority}</priority>
            </url>`;
        });

        const productsCursor = productsCollection.find({}, { projection: { sku: 1, updatedAt: 1, importedAt: 1 } });
        
        for await (const product of productsCursor) {
             if (!product.sku) continue;
             const lastModDate = product.updatedAt || product.importedAt || new Date();
             const lastMod = lastModDate.toISOString().split('T')[0];
             xml += `
            <url>
                <loc>${baseUrl}/products/${encodeURIComponent(product.sku)}</loc>
                <lastmod>${lastMod}</lastmod>
                <priority>0.70</priority>
            </url>`;
        }

        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.status(200).send(xml);

    } catch (err) {
        next(err);
    }
});

// --- Main Application Start Function ---
async function main() {
    try {
        await client.connect();
        console.log("Successfully connected to MongoDB Atlas");

        // Test DB Connection
        await client.db(app.locals.dbName).command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

        // --- Import Routes ---
        const indexRoute = require('./routes/index');
        const usersRoute = require('./routes/users');
        const passwordRoute = require('./routes/password');
        const productsRoute = require('./routes/products');
        const cartRoute = require('./routes/cart');
        const checkoutRoute = require('./routes/checkout');
        const accountRoute = require('./routes/account');
        const supportRoute = require('./routes/support');

        // --- Mount Routes ---

        app.post('/currency/change', (req, res) => {
            const { country, returnTo } = req.body;
            if (country && countryData[country]) {
                req.session.country_override = country; 
            } else {
                 delete req.session.country_override; 
            }
            res.redirect(returnTo || '/');
        });

        app.use('/', indexRoute);
        app.use('/users', usersRoute);
        app.use('/password', passwordRoute);
        app.use('/products', productsRoute);
        app.use('/cart', cartRoute);
        app.use('/checkout', checkoutRoute);
        app.use('/account', accountRoute);
        app.use('/support', supportRoute);

        // --- Error Handlers ---
        app.use((req, res, next) => {
             if (!res.headersSent) {
                res.status(404).render("404", { title: "Page Not Found" });
             } else {
                next();
             }
        });

        app.use((err, req, res, next) => {
            console.error(`Error on ${req.method} ${req.originalUrl}:`, err);
            if (res.headersSent) return next(err);
            res.status(err.status || 500).render('500', {
                 title: 'Server Error',
                 error: process.env.NODE_ENV === 'development' ? err : { message: "An unexpected error occurred." }
            });
        });

        // Start Server
        server.listen(port, () => {
            console.log(`Server running and listening on http://localhost:${port}`);
        });

    } catch (err) {
        console.error("FATAL ERROR during application startup:", err);
        process.exit(1);
    }
}

// --- Graceful Shutdown Logic ---
async function gracefulShutdown(signal) {
    console.log(`\n${signal} signal received: Closing server...`);
    server.close(async () => {
        console.log('HTTP server closed.');
        if (client && client.topology && client.topology.isConnected()) {
            await client.close();
            console.log('MongoDB connection closed.');
        }
        process.exit(0);
    });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main();