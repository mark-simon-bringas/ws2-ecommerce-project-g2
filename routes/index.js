// routes/index.js

const express = require('express');
const router = express.Router();
const { convertCurrency } = require('./currency');

// Fisher-Yates (aka Knuth) Shuffle function
function shuffleArray(array) {
    let currentIndex = array.length, randomIndex;
    // While there remain elements to shuffle.
    while (currentIndex != 0) {
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }
    return array;
}

router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const usersCollection = db.collection('users');
        const currency = res.locals.locationData.currency;

        let userWishlist = [];
        if (req.session.user) {
            const user = await usersCollection.findOne({ userId: req.session.user.userId });
            if (user && user.wishlist) {
                userWishlist = user.wishlist;
            }
        }

        const [allProducts, jordanProducts] = await Promise.all([
            productsCollection.find().sort({ importedAt: -1 }).toArray(),
            productsCollection.find({ brand: 'Jordan' }).toArray()
        ]);
        
        // Shuffle and slice the arrays to get random assortments
        const newArrivals = shuffleArray([...allProducts]).slice(0, 8);
        const topKicks = shuffleArray([...allProducts]).slice(0, 8);
        const jordanCollection = shuffleArray([...jordanProducts]).slice(0, 8);

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
        const allProductsForModal = Array.from(allProductsMap.values());

        res.render('index', { 
            title: "Find Your Perfect Pair",
            newArrivals: convertedNewArrivals,
            topKicks: convertedTopKicks,
            jordanCollection: convertedJordanCollection,
            allProducts: allProductsForModal,
            wishlist: userWishlist
        });

    } catch (err) {
        console.error("Error fetching products for homepage:", err);
        res.status(500).send("Error loading the homepage.");
    }
});

// Route for the about page
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