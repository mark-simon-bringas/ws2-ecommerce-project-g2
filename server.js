// server.js

const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb'); // Added ObjectId
const session = require('express-session');
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
const geoip = require('geoip-lite');
const { getCountryData, countryData } = require('./utils/currencyMap');
// REMOVED: const { create } = require('xmlbuilder2'); // Ensure this is removed or commented out
require('dotenv').config();


const http = require('http');
const { Server } = require("socket.io");

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 5000;


const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public')); // Serve static files

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
        // secure: false, // Commented out duplicate
        maxAge: 15 * 60 * 1000 // Session timeout: 15 minutes
    }
}));

// Middleware to set local variables for views
app.use(async (req, res, next) => {
    res.locals.currentUser = req.session.user;
    res.locals.cart = req.session.cart;
    
    // *** CRITICAL: Ensure path is available for the returnTo logic ***
    res.locals.path = req.originalUrl; 

    // Use a default IP for localhost testing, otherwise use the request IP
    const ip = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(req.ip) ? '122.54.69.1' : req.ip; // Added ::ffff:127.0.0.1 for some Node versions
    const geo = geoip.lookup(ip);

    // Determine country code from session override or geoip lookup
    const countryCode = req.session.country_override || (geo ? geo.country : 'US'); // Default to 'US'

    res.locals.currentCountryCode = countryCode;
    res.locals.locationData = getCountryData(countryCode);
    res.locals.countryData = countryData; // Pass all country data for the dropdown

    // Fetch admin counts only if admin is logged in
    if (req.session.user && req.session.user.role === 'admin') {
        try {
            // Check if MongoDB client is connected before querying
            if (req.app.locals.client && req.app.locals.client.topology && req.app.locals.client.topology.isConnected()) {
                const db = req.app.locals.client.db(req.app.locals.dbName);
                const [newOrderCount, newTicketCount] = await Promise.all([
                    db.collection('orders').countDocuments({ isNew: true }),
                    db.collection('support_tickets').countDocuments({ status: 'Open' })
                ]);
                res.locals.newOrderCount = newOrderCount;
                res.locals.newTicketCount = newTicketCount;
            } else {
                 console.warn("Admin counts skipped: MongoDB client not connected.");
                 res.locals.newOrderCount = 0;
                 res.locals.newTicketCount = 0;
            }
        } catch (err) {
            console.error("Error fetching admin counts:", err);
            res.locals.newOrderCount = 0;
            res.locals.newTicketCount = 0;
        }
    } else {
        // Ensure these locals are always defined, even if not admin
        res.locals.newOrderCount = 0;
        res.locals.newTicketCount = 0;
    }

    next(); // Proceed to the next middleware or route
});

// MongoDB Setup
const uri = process.env.MONGO_URI;
if (!uri) {
    console.error("FATAL ERROR: MONGO_URI environment variable is not set.");
    process.exit(1);
}
const client = new MongoClient(uri);

// Store client and dbName globally for access in routes
app.locals.client = client;
app.locals.dbName = process.env.DB_NAME || "ecommerceDB";


// Socket.IO Setup for real-time chat
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Join a room specific to a ticket
    socket.on('joinTicket', (ticketId) => {
        if (ticketId) {
            socket.join(ticketId);
            console.log(`Socket ${socket.id} joined ticket room: ${ticketId}`);
        } else {
            console.warn(`Socket ${socket.id} attempted to join an undefined ticket room.`);
        }
    });

    // Handle incoming chat messages
    socket.on('chatMessage', async (data) => {
        // Basic validation
        if (!data || !data.ticketId || !data.message || !data.sender) {
            console.error('Invalid chat message data received:', data);
            socket.emit('chatError', 'Invalid message data.'); // Send error back to sender
            return;
        }

        try {
            const db = app.locals.client.db(app.locals.dbName);
            const ticketsCollection = db.collection('support_tickets');

            const newMessage = {
                sender: data.sender, // Should be 'user' or 'admin'
                name: data.name || 'User', // User's name from ticket or default
                adminName: data.adminName || null, // Admin's name if sender is admin
                message: data.message.trim(), // Trim whitespace
                timestamp: new Date()
            };

            // Determine the new status based on who sent the message
            const newStatus = data.sender === 'admin' ? 'Answered' : 'Open';

            // Update the ticket in the database
            const updateResult = await ticketsCollection.updateOne(
                { ticketId: data.ticketId },
                {
                    $push: { messages: newMessage },
                    $set: { status: newStatus, updatedAt: new Date() }
                }
            );

            if (updateResult.modifiedCount === 1) {
                // Emit the new message ONLY to clients in the specific ticket room
                io.to(data.ticketId).emit('newMessage', newMessage);
                 console.log(`Message in room ${data.ticketId} by ${newMessage.sender}: ${newMessage.message}`);
            } else {
                 console.error(`Failed to update database for ticket ${data.ticketId}. Message not broadcasted.`);
                 socket.emit('chatError', 'Could not save message to database.');
            }

        } catch (err) {
            console.error('Database error handling chat message:', err);
            socket.emit('chatError', 'Server error processing message.');
        }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
        console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
    });
});


// =================================== //
// ===== DYNAMIC SITEMAP ROUTE ===== //
// =================================== //
app.get('/sitemap.xml', async (req, res, next) => {
    console.log(`Received request for /sitemap.xml at ${new Date().toISOString()}`);
    try {
        // Check DB connection
        if (!req.app.locals.client || !req.app.locals.client.topology || !req.app.locals.client.topology.isConnected()) {
             console.error("Sitemap generation failed: Database not connected.");
             throw new Error("Sitemap generation failed: Database not connected.");
        }

        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const baseUrl = process.env.BASE_URL_LIVE || 'https://www.sneakslab.shop'; 
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // 1. Start XML String
        let xml = '<?xml version="1.0" encoding="UTF-8"?>';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

        // 2. Define Static Pages
        const staticPages = [
            { loc: '/', priority: '1.00' },
            { loc: '/products', priority: '0.90' },
            { loc: '/about', priority: '0.50' },
            { loc: '/legal', priority: '0.50' },
            { loc: '/users/login', priority: '0.50' },
            { loc: '/users/register', priority: '0.50' },
            { loc: '/password/forgot', priority: '0.50' },
            { loc: '/support', priority: '0.50' },
            { loc: '/support/contact', priority: '0.50' },
            { loc: '/support/order-status', priority: '0.50' },
            { loc: '/support/shipping', priority: '0.50' },
            { loc: '/support/returns', priority: '0.50' },
            { loc: '/products?category=men', priority: '0.80' },
            { loc: '/products?category=women', priority: '0.80' },
            { loc: '/products?brand=Nike', priority: '0.85' },
            { loc: '/products?brand=Jordan', priority: '0.85' },
            { loc: '/products?brand=Adidas', priority: '0.85' },
            { loc: '/products?brand=New%20Balance', priority: '0.85' },
            { loc: '/products?new=true', priority: '0.80' },
        ];

        // 3. Add Static Pages to XML
        staticPages.forEach(page => {
            const fullUrl = baseUrl + page.loc;
            xml += `
            <url>
                <loc>${fullUrl}</loc>
                <lastmod>${today}</lastmod>
                <priority>${page.priority}</priority>
            </url>`;
        });

        // 4. Fetch & Add Product Pages
        const productsCursor = productsCollection.find({}, { projection: { sku: 1, updatedAt: 1, importedAt: 1 } });
        
        for await (const product of productsCursor) {
             if (!product.sku) continue;

             const lastModDate = product.updatedAt || product.importedAt || new Date();
             const lastMod = lastModDate.toISOString().split('T')[0];
             // Escape special characters in SKU if necessary
             const safeSku = encodeURIComponent(product.sku);

             xml += `
            <url>
                <loc>${baseUrl}/products/${safeSku}</loc>
                <lastmod>${lastMod}</lastmod>
                <priority>0.70</priority>
            </url>`;
        }

        // 5. Close XML
        xml += '</urlset>';

        // Send Response
        res.header('Content-Type', 'application/xml');
        res.status(200).send(xml);

    } catch (err) {
        console.error("ERROR in /sitemap.xml route handler:", err);
        next(err);
    }
});

// --- Main Application Start Function ---
async function main() {
    try {
        // Connect to MongoDB
        await client.connect();
        console.log("Successfully connected to MongoDB Atlas");

        // Test DB Connection
        await client.db(app.locals.dbName).command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");


        // --- Import Routes (AFTER DB connection established) ---
        const indexRoute = require('./routes/index');
        const usersRoute = require('./routes/users');
        const passwordRoute = require('./routes/password');
        const productsRoute = require('./routes/products');
        const cartRoute = require('./routes/cart');
        const checkoutRoute = require('./routes/checkout');
        const accountRoute = require('./routes/account');
        const supportRoute = require('./routes/support');

        // --- Mount Routes ---

        // Currency Change Route - UPDATED to assume 'returnTo' is passed
        app.post('/currency/change', (req, res) => {
            const { country, returnTo } = req.body;
            
            if (country && countryData[country]) {
                req.session.country_override = country; // Store override in session
                console.log(`Currency override set to: ${country}`);
            } else {
                 delete req.session.country_override; // Clear override if invalid
                 console.log(`Currency override cleared or invalid country received: ${country}`);
            }
            
            // Redirect back using the returnTo parameter, defaulting to home if missing
            const safeRedirect = returnTo || '/';
            res.redirect(safeRedirect);
        });

        // Application Feature Routes (AFTER sitemap.xml)
        app.use('/', indexRoute);
        app.use('/users', usersRoute);
        app.use('/password', passwordRoute);
        app.use('/products', productsRoute);
        app.use('/cart', cartRoute);
        app.use('/checkout', checkoutRoute);
        app.use('/account', accountRoute);
        app.use('/support', supportRoute);

        // --- Error Handlers (Must be LAST) ---

        // 404 Handler for unmatched routes
        app.use((req, res, next) => {
             // Check if headers already sent
             if (!res.headersSent) {
                res.status(404).render("404", { title: "Page Not Found" });
             } else {
                 console.warn(`Headers already sent for 404 on ${req.originalUrl}, cannot render 404 page.`);
                next();
             }
        });

        // Global Error Handler (500)
        app.use((err, req, res, next) => {
            console.error("--- Global Error Handler Activated ---");
            console.error(`Timestamp: ${new Date().toISOString()}`);
            console.error(`Route: ${req.method} ${req.originalUrl}`);
            const errorStatus = err.status || 500;
            console.error(`Error Status: ${errorStatus}`);
            console.error(`Error Message: ${err.message}`);
            
            if (errorStatus !== 404) {
                 console.error(err.stack);
            }

            if (res.headersSent) {
                console.error("Headers already sent, cannot render 500 page. Passing error to default handler.");
                return next(err);
            }

            res.status(errorStatus).render('500', {
                 title: 'Server Error',
                 error: process.env.NODE_ENV === 'development' ? err : { message: "An unexpected error occurred." }
            });
        });


        // Start the HTTP server
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
    console.log(`\n${signal} signal received: Closing server and MongoDB connection...`);
    server.close(async () => {
        console.log('HTTP server closed.');
        if (client && client.topology && client.topology.isConnected()) {
            await client.close();
            console.log('MongoDB connection closed.');
        } else {
            console.log('MongoDB connection already closed or not established.');
        }
        process.exit(0);
    });

    setTimeout(() => {
        console.error('Could not close connections gracefully, forcing shutdown.');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main();