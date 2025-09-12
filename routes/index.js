const express = require('express');
const router = express.Router();


router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const usersCollection = db.collection('users');

        // Added: Fetch user's wishlist if they are logged in
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
            allProducts: allProducts,
            wishlist: userWishlist // Added: Pass wishlist to the template
        });

    } catch (err) {
        console.error("Error fetching products for homepage:", err);
        res.status(500).send("Error loading the homepage.");
    }
});

module.exports = router;