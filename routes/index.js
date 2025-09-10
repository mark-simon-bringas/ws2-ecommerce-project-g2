const express = require('express');
const router = express.Router();


router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');

        // Fetch all data required for the new dynamic homepage in parallel
        const [
            newArrivals,
            topKicks,
            jordanCollection
        ] = await Promise.all([
            // Carousel 1: Get the 8 latest products
            productsCollection.find().sort({ importedAt: -1 }).limit(8).toArray(),
            // Carousel 2: Get another 8 products, skipping the latest ones for variety
            productsCollection.find().sort({ importedAt: -1 }).skip(8).limit(8).toArray(),
            // Carousel 3: Get 8 products specifically from the Jordan brand
            productsCollection.find({ brand: 'Jordan' }).limit(8).toArray()
        ]);
        
        // Combine all products and remove duplicates to properly render the modals
        const allProductsMap = new Map();
        [...newArrivals, ...topKicks, ...jordanCollection].forEach(product => {
            allProductsMap.set(product._id.toString(), product);
        });
        const allProducts = Array.from(allProductsMap.values());

        res.render('index', { 
            title: "Find Your Perfect Pair",
            newArrivals: newArrivals,
            topKicks: topKicks,
            jordanCollection: jordanCollection,
            allProducts: allProducts // Pass this combined list for the modals
        });

    } catch (err) {
        console.error("Error fetching products for homepage:", err);
        res.status(500).send("Error loading the homepage.");
    }
});

module.exports = router;