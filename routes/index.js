// routes/index.js

const express = require('express');
const router = express.Router();
const { convertCurrency } = require('./currency');


router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const usersCollection = db.collection('users');
        const currency = res.locals.locationData.currency;

        // Fetch user's wishlist if they are logged in
        let userWishlist = [];
        if (req.session.user) {
            const user = await usersCollection.findOne({ userId: req.session.user.userId });
            if (user && user.wishlist) {
                userWishlist = user.wishlist;
            }
        }

        // Fetch all data required for the new dynamic homepage in parallel
        const [
            newArrivals,
            topKicks,
            jordanCollection
        ] = await Promise.all([
            productsCollection.find().sort({ importedAt: -1 }).limit(8).toArray(),
            productsCollection.find().sort({ importedAt: -1 }).skip(8).limit(8).toArray(),
            productsCollection.find({ brand: 'Jordan' }).limit(8).toArray()
        ]);

        // Helper function to convert prices for an array of products
        const convertPrices = (products) => {
            return Promise.all(products.map(async (product) => {
                product.convertedPrice = await convertCurrency(product.retailPrice, currency);
                return product;
            }));
        };
        
        const [
            convertedNewArrivals,
            convertedTopKicks,
            convertedJordanCollection
        ] = await Promise.all([
            convertPrices(newArrivals),
            convertPrices(topKicks),
            convertPrices(jordanCollection)
        ]);
        
        const allProductsMap = new Map();
        [...convertedNewArrivals, ...convertedTopKicks, ...convertedJordanCollection].forEach(product => {
            allProductsMap.set(product._id.toString(), product);
        });
        const allProducts = Array.from(allProductsMap.values());

        res.render('index', { 
            title: "Find Your Perfect Pair",
            newArrivals: convertedNewArrivals,
            topKicks: convertedTopKicks,
            jordanCollection: convertedJordanCollection,
            allProducts: allProducts,
            wishlist: userWishlist
        });

    } catch (err) {
        console.error("Error fetching products for homepage:", err);
        res.status(500).send("Error loading the homepage.");
    }
});

// ADDED: Route for the about page
router.get('/about', (req, res) => {
    res.render('about', {
        title: 'About Us'
    });
});

// Route for the legal page
router.get('/legal', (req, res) => {
    res.render('legal', {
        title: 'Terms & Privacy'
    });
});

module.exports = router;