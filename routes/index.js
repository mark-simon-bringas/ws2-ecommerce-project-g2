const express = require('express');
const router = express.Router();


router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');

        // Fetch new arrivals and a separate batch of featured products in parallel
        const [newArrivals, featuredProducts] = await Promise.all([
            productsCollection.find().sort({ importedAt: -1 }).limit(4).toArray(),
            productsCollection.find({}).skip(4).limit(4).toArray() // Grabbing a different set of products for variety
        ]);
        
        res.render('index', { 
            title: "Find Your Perfect Pair",
            newArrivals: newArrivals,
            featuredProducts: featuredProducts
        });

    } catch (err) {
        console.error("Error fetching products for homepage:", err);
        res.status(500).send("Error loading the homepage.");
    }
});

module.exports = router;