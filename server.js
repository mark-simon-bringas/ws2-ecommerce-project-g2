const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
<<<<<<< Updated upstream
=======
const session = require('express-session'); 
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
>>>>>>> Stashed changes
require('dotenv').config();
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
<<<<<<< Updated upstream
=======
app.use(express.static('public'));

// -- View Engine Setup --
app.set('views', path.join(__dirname, 'views'));
>>>>>>> Stashed changes
app.set('view engine', 'ejs');
app.use(ejsLayouts);

<<<<<<< Updated upstream
// Routes <-- Update
const indexRoute = require('./routes/index');
const usersRoute = require('./routes/users');

app.use('/', indexRoute);
app.use('/users', usersRoute);
=======
// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, 
        maxAge: 15 * 60 * 1000 
    } 
}));
>>>>>>> Stashed changes

// Custom middleware to make user session and cart available to all views
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user;
    res.locals.cart = req.session.cart; // Make cart available to all views
    next();
});

// MongoDB Setup
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);
<<<<<<< Updated upstream
=======

app.locals.client = client;
app.locals.dbName = process.env.DB_NAME || "ecommerceDB";

>>>>>>> Stashed changes
async function main() {
    try {
        await client.connect();
        console.log("Connected to MongoDB Atlas");
<<<<<<< Updated upstream
        
        // Select database
        const database = client.db("ecommerceDB");
        
        // Start server
=======

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
       
>>>>>>> Stashed changes
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error("MongoDB connection failed", err);
    }
}
main();