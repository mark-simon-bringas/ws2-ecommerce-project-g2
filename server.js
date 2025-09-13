const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const session = require('express-session'); 
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
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

// Custom middleware to make user session and cart available to all views
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user;
    res.locals.cart = req.session.cart;
    res.locals.path = req.path;
    next();
});

// MongoDB Setup
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

app.locals.client = client;
app.locals.dbName = process.env.DB_NAME || "ecommerceDB";

// Function to create database indexes for performance
async function createDbIndexes() {
    try {
        const db = client.db(app.locals.dbName);
        console.log("Ensuring database indexes exist...");

        // UPDATED: Temporarily removed the 'unique' constraint for diagnostics
        await db.collection('users').createIndex({ email: 1 });
        await db.collection('users').createIndex({ userId: 1 });
        await db.collection('products').createIndex({ sku: 1 });
        await db.collection('products').createIndex({ brand: 1 });
        await db.collection('orders').createIndex({ userId: 1 });
        await db.collection('activity_log').createIndex({ timestamp: -1 });

        console.log("Database indexes are in place.");
    } catch (err) {
        console.error("Error creating database indexes:", err);
    }
}


async function main() {
    try {
        await client.connect();
        console.log("Connected to MongoDB Atlas");

        await createDbIndexes();

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