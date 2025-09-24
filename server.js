// server.js

const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const session = require('express-session');
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
const geoip = require('geoip-lite');
const { getCountryData, countryData } = require('./utils/currencyMap');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

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
        secure: false,
        maxAge: 15 * 60 * 1000
    }
}));

app.use(async (req, res, next) => {
    res.locals.currentUser = req.session.user;
    res.locals.cart = req.session.cart;
    res.locals.path = req.originalUrl;

    const ip = req.ip === '::1' || req.ip === '127.0.0.1' ? '122.54.69.1' : req.ip;
    const geo = geoip.lookup(ip);

    const countryCode = req.session.country_override || (geo ? geo.country : 'US');

    res.locals.currentCountryCode = countryCode;
    res.locals.locationData = getCountryData(countryCode);
    res.locals.countryData = countryData;

    if (req.session.user && req.session.user.role === 'admin') {
        try {
            const db = req.app.locals.client.db(req.app.locals.dbName);
            const newOrderCount = await db.collection('orders').countDocuments({ isNew: true });
            const newTicketCount = await db.collection('support_tickets').countDocuments({ status: 'Open' });
            res.locals.newOrderCount = newOrderCount;
            res.locals.newTicketCount = newTicketCount;
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
const client = new MongoClient(uri);

app.locals.client = client;
app.locals.dbName = process.env.DB_NAME || "ecommerceDB";

async function main() {
    try {
        await client.connect();
        console.log("Connected to MongoDB Atlas");

        const indexRoute = require('./routes/index');
        const usersRoute = require('./routes/users');
        const passwordRoute = require('./routes/password');
        const productsRoute = require('./routes/products');
        const cartRoute = require('./routes/cart');
        const checkoutRoute = require('./routes/checkout');
        const accountRoute = require('./routes/account');
        const supportRoute = require('./routes/support');

        app.post('/currency/change', (req, res) => {
            const { country } = req.body;
            if (country && countryData[country]) {
                req.session.country_override = country;
            }
            res.redirect(req.header('Referer') || '/');
        });

        app.use('/', indexRoute);
        app.use('/users', usersRoute);
        app.use('/password', passwordRoute);
        app.use('/products', productsRoute);
        app.use('/cart', cartRoute);
        app.use('/checkout', checkoutRoute);
        app.use('/account', accountRoute);
        app.use('/support', supportRoute); 

        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error("MongoDB connection failed", err);
        process.exit(1);
    }
}

main();