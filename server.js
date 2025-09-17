const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const session = require('express-session'); 
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
const geoip = require('geoip-lite');
const { getCurrency } = require('./utils/currencyMap');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

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
        maxAge: 15 * 60 * 1000 
    } 
}));

// UPDATED: Custom middleware now fetches new order count for admins, detects country, and sets currency
app.use(async (req, res, next) => {
    res.locals.currentUser = req.session.user;
    res.locals.cart = req.session.cart;
    res.locals.path = req.path;
    
    // Country and Currency Detection
    const ip = req.ip === '::1' || req.ip === '127.0.0.1' ? '122.54.69.1' : req.ip;
    const geo = geoip.lookup(ip);
    res.locals.country = geo ? geo.country : 'US'; 
    res.locals.currency = getCurrency(res.locals.country);

    // If an admin is logged in, count the number of new orders
    if (req.session.user && req.session.user.role === 'admin') {
        try {
            const db = req.app.locals.client.db(req.app.locals.dbName);
            const newOrderCount = await db.collection('orders').countDocuments({ isNew: true });
            res.locals.newOrderCount = newOrderCount;
        } catch (err) {
            console.error("Error fetching new order count:", err);
            res.locals.newOrderCount = 0;
        }
    } else {
        res.locals.newOrderCount = 0;
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

        app.use('/', indexRoute);
        app.use('/users', usersRoute);
        app.use('/password', passwordRoute);
        app.use('/products', productsRoute);
        app.use('/cart', cartRoute);
        app.use('/checkout', checkoutRoute);
        app.use('/account', accountRoute);
       
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error("MongoDB connection failed", err);
        process.exit(1); 
    }
}

main();