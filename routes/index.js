// routes/index.js

const express = require('express');
const router = express.Router();
const { convertCurrency } = require('./currency');
const { ObjectId } = require('mongodb');

// Helper function to apply sales to products
async function applySalesToProducts(products, db) {
    if (!products || products.length === 0) {
        return [];
    }
    const now = new Date();
    const activeSales = await db.collection('sales').find({
        startDate: { $lte: now },
        endDate: { $gte: now }
    }).toArray();
    if (activeSales.length === 0) {
        return products.map(p => ({ ...p, onSale: false }));
    }
    const saleMap = new Map();
    activeSales.forEach(sale => {
        sale.productIds.forEach(productId => {
            saleMap.set(productId.toString(), {
                discountPercentage: sale.discountPercentage
            });
        });
    });
    return products.map(product => {
        const saleInfo = saleMap.get(product._id.toString());
        if (saleInfo) {
            const salePrice = product.retailPrice * (1 - saleInfo.discountPercentage / 100);
            return {
                ...product,
                onSale: true,
                salePrice: parseFloat(salePrice.toFixed(2)),
                discountPercentage: saleInfo.discountPercentage
            };
        }
        return { ...product, onSale: false };
    });
}

// Fisher-Yates (aka Knuth) Shuffle function
function shuffleArray(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
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
        const salesCollection = db.collection('sales');
        const currency = res.locals.locationData.currency;

        let userWishlist = [];
        if (req.session.user) {
            const user = await usersCollection.findOne({ userId: req.session.user.userId });
            if (user && user.wishlist) {
                userWishlist = user.wishlist;
            }
        }

        // --- Fetch Active Sale Products ---
        let saleProducts = [];
        let activeSale = null;
        const now = new Date();
        
        activeSale = await salesCollection.findOne({
            startDate: { $lte: now },
            endDate: { $gte: now }
        });

        if (activeSale) {
            saleProducts = await productsCollection.find({ _id: { $in: activeSale.productIds } }).toArray();
        }
        
        // --- Fetch Other Product Carousels ---
        const aggregationPipeline = [
            {
                $lookup: {
                    from: 'reviews',
                    localField: '_id',
                    foreignField: 'productId',
                    as: 'reviews'
                }
            },
            {
                $addFields: {
                    averageRating: { $avg: '$reviews.rating' }
                }
            }
        ];

        const [allProducts, jordanProducts] = await Promise.all([
            productsCollection.aggregate(aggregationPipeline).sort({ importedAt: -1 }).toArray(),
            productsCollection.aggregate([ { $match: { brand: 'Jordan' } }, ...aggregationPipeline ]).toArray()
        ]);
        
        // Apply sales logic to ALL product lists
        const [
            allProductsWithSales,
            jordanProductsWithSales,
            saleProductsWithSales
        ] = await Promise.all([
            applySalesToProducts(allProducts, db),
            applySalesToProducts(jordanProducts, db),
            applySalesToProducts(saleProducts, db)
        ]);

        const newArrivals = shuffleArray([...allProductsWithSales]).slice(0, 20);
        const topKicks = shuffleArray([...allProductsWithSales]).slice(0, 20);
        const jordanCollection = shuffleArray([...jordanProductsWithSales]).slice(0, 20);

        const convertPrices = (products) => {
            return Promise.all(products.map(async (product) => {
                product.convertedPrice = await convertCurrency(product.retailPrice, currency);
                if (product.onSale) {
                     product.convertedSalePrice = await convertCurrency(product.salePrice, currency);
                }
                return product;
            }));
        };
        
        const [
            convertedSaleProducts,
            convertedNewArrivals,
            convertedTopKicks,
            convertedJordanCollection
        ] = await Promise.all([
            convertPrices(saleProductsWithSales),
            convertPrices(newArrivals),
            convertPrices(topKicks),
            convertPrices(jordanCollection)
        ]);
        
        const allProductsMap = new Map();
        [...convertedSaleProducts, ...convertedNewArrivals, ...convertedTopKicks, ...convertedJordanCollection].forEach(product => {
            allProductsMap.set(product._id.toString(), product);
        });
        const allProductsForModal = Array.from(allProductsMap.values());

        res.render('index', { 
            title: "Find Your Perfect Pair",
            activeSale: activeSale,
            saleProducts: convertedSaleProducts,
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