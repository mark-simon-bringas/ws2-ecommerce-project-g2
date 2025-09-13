const express = require('express');
const router = express.Router();
const axios = require('axios');
const { ObjectId } = require('mongodb');

// Middleware to check if the user is logged in
const isLoggedIn = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/users/login');
    }
    next();
};

// Middleware to check if user is an admin for specific routes
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send("Access Denied.");
};

// GET /products - The main shop page with filtering
router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const usersCollection = db.collection('users');

        let userWishlist = [];
        if (req.session.user) {
            const user = await usersCollection.findOne({ userId: req.session.user.userId });
            if (user && user.wishlist) {
                userWishlist = user.wishlist;
            }
        }

        let query = {};
        let sort = {};
        let pageTitle = "Shop All";

        if (req.query.category) {
            query.gender = req.query.category;
            pageTitle = `${req.query.category.charAt(0).toUpperCase() + req.query.category.slice(1)}'s Collection`;
        }
        
        if (req.query.brand) {
            query.brand = req.query.brand;
            pageTitle = `${req.query.brand} Collection`;
        }

        if (req.query.new === 'true') {
            sort = { importedAt: -1 };
            pageTitle = "New Arrivals";
        }

        const products = await productsCollection.find(query).sort(sort).toArray();
        
        res.render('shop', { 
            title: pageTitle,
            pageTitle: pageTitle,
            products: products,
            wishlist: userWishlist
        });

    } catch (err) {
        console.error("Error fetching products for shop page:", err);
        res.status(500).send("Error loading the shop page.");
    }
});

// GET /products/search - Handle search queries
router.get('/search', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const usersCollection = db.collection('users');
        const searchQuery = req.query.q || "";

        let userWishlist = [];
        if (req.session.user) {
            const user = await usersCollection.findOne({ userId: req.session.user.userId });
            if (user && user.wishlist) {
                userWishlist = user.wishlist;
            }
        }

        const query = {
            $or: [
                { name: { $regex: searchQuery, $options: 'i' } },
                { brand: { $regex: searchQuery, $options: 'i' } }
            ]
        };

        const products = await productsCollection.find(query).toArray();
        const pageTitle = `Search results for "${searchQuery}"`;

        res.render('shop', {
            title: pageTitle,
            pageTitle: pageTitle,
            products: products,
            wishlist: userWishlist
        });

    } catch (err) {
        console.error("Error searching products:", err);
        res.status(500).send("Error performing search.");
    }
});


// Route to display the admin product management page
router.get('/manage', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const localProductsPromise = productsCollection.find().sort({ importedAt: -1 }).toArray();

        const apiOptions = {
            method: 'GET',
            url: 'https://the-sneaker-database.p.rapidapi.com/search',
            params: { limit: '20', query: 'Popular' },
            headers: {
                'X-RapidAPI-Key': process.env.SNEAKER_DB_API_KEY,
                'X-RapidAPI-Host': 'the-sneaker-database.p.rapidapi.com'
            }
        };
        const apiProductsPromise = axios.request(apiOptions);

        const [localProducts, apiResponse] = await Promise.all([localProductsPromise, apiProductsPromise]);

        res.render('admin-products', {
            title: "Manage Products",
            view: 'admin-products',
            user: req.session.user,
            currentUser: req.session.user,
            localProducts: localProducts, 
            apiProducts: apiResponse.data.results 
        });

    } catch (error) {
        console.error("Data fetching for manage page failed:", error.response ? error.response.data : error.message);
        res.render('admin-products', {
            title: "Manage Products",
            view: 'admin-products',
            user: req.session.user,
            currentUser: req.session.user,
            localProducts: [],
            apiProducts: []
        });
    }
});

// Route to handle search and filter out existing products
router.post('/search', isAdmin, async (req, res) => {
    const { query, brand, gender } = req.body;

    let fullQuery = query;
    if (brand) {
        fullQuery += ` ${brand}`;
    }
    if (gender) {
        fullQuery += ` ${gender}`;
    }

    const options = {
        method: 'GET',
        url: 'https://the-sneaker-database.p.rapidapi.com/search',
        params: { limit: '20', query: fullQuery },
        headers: {
            'X-RapidAPI-Key': process.env.SNEAKER_DB_API_KEY,
            'X-RapidAPI-Host': 'the-sneaker-database.p.rapidapi.com'
        }
    };

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');

        const response = await axios.request(options);
        const apiProducts = response.data.results;

        const existingProducts = await productsCollection.find().project({ sku: 1, _id: 0 }).toArray();
        const existingSkus = new Set(existingProducts.map(p => p.sku));

        const newProducts = apiProducts.filter(p => !existingSkus.has(p.sku));

        let html = '';
        if (newProducts && newProducts.length > 0) {
            newProducts.forEach(product => {
                const productDataString = JSON.stringify(product);
                html += `
                    <div class="col">
                        <div class="card h-100 shadow-sm product-import-card">
                            <input type="checkbox" name="selectedProducts" class="product-checkbox form-check-input" value='${productDataString.replace(/'/g, "&apos;")}'>
                            <img src="${product.image.thumbnail}" class="card-img-top p-3" alt="${product.name}" style="object-fit: contain; height: 250px;">
                            <div class="card-body">
                                <h5 class="card-title small">${product.name}</h5>
                                <p class="card-text text-body-secondary small">${product.brand} | SKU: ${product.sku}</p>
                                <h6 class="card-subtitle mb-2 fw-bold">$${product.retailPrice}</h6>
                            </div>
                        </div>
                    </div>
                `;
            });
        } else {
            html = `<div class="col-12"><div class="text-center p-5 bg-light rounded"><p class="lead text-body-secondary">No new products found for your search.</p></div></div>`;
        }
        res.send(html);
    } catch (error) {
        console.error("API call failed:", error.response ? error.response.data : error.message);
        const errorHtml = `<div class="col-12"><div class="alert alert-danger">API request failed. Please check the server console for details.</div></div>`;
        res.status(500).send(errorHtml);
    }
});

// Route to handle bulk importing with stock initialization ONLY
router.post('/import-multiple', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const activityLogCollection = db.collection('activity_log');
        let { selectedProducts } = req.body;
        if (!selectedProducts) { return res.redirect('/products/manage'); }
        if (!Array.isArray(selectedProducts)) { selectedProducts = [selectedProducts]; }

        const productsToInsert = [];
        const standardSizes = ['8', '8.5', '9', '9.5', '10', '10.5', '11', '12'];

        for (const productString of selectedProducts) {
            const product = JSON.parse(productString);

            const initialStock = standardSizes.reduce((acc, size) => {
                const safeSizeKey = size.replace('.', '_');
                acc[safeSizeKey] = 10;
                return acc;
            }, {});

            productsToInsert.push({
                name: product.name,
                sku: product.sku,
                brand: product.brand,
                gender: product.gender,
                retailPrice: Number(product.retailPrice),
                imageUrl: product.image.original,
                thumbnailUrl: product.image.thumbnail,
                importedAt: new Date(),
                stock: initialStock
            });
        }

        const skusToInsert = productsToInsert.map(p => p.sku);
        const existingProducts = await productsCollection.find({ sku: { $in: skusToInsert } }).project({ sku: 1 }).toArray();
        const existingSkus = new Set(existingProducts.map(p => p.sku));
        const newProducts = productsToInsert.filter(p => !existingSkus.has(p.sku));

        if (newProducts.length > 0) {
            await productsCollection.insertMany(newProducts);

            const logEntry = {
                userId: req.session.user.userId,
                userFirstName: req.session.user.firstName,
                userRole: req.session.user.role,
                actionType: 'PRODUCT_IMPORT',
                details: {
                    productCount: newProducts.length
                },
                timestamp: new Date()
            };
            await activityLogCollection.insertOne(logEntry);
        }
        res.redirect('/products/manage');
    } catch (err) {
        console.error("Error importing multiple products:", err);
        res.status(500).send("An error occurred during the bulk import.");
    }
});


// Route to delete a single product
router.post('/delete', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const { productId } = req.body;
        await productsCollection.deleteOne({ _id: new ObjectId(productId) });
        res.redirect('/products/manage');
    } catch (err) {
        console.error("Error deleting product:", err);
        res.status(500).send("An error occurred while deleting the product.");
    }
});

// Route to handle bulk deletion of multiple products
router.post('/delete-multiple', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        let { productIds } = req.body;

        if (!productIds) {
            return res.redirect('/products/manage');
        }
        if (!Array.isArray(productIds)) {
            productIds = [productIds];
        }

        const objectIdsToDelete = productIds.map(id => new ObjectId(id));

        await productsCollection.deleteMany({
            _id: { $in: objectIdsToDelete }
        });

        res.redirect('/products/manage');

    } catch (err) {
        console.error("Error deleting multiple products:", err);
        res.status(500).send("An error occurred during the bulk delete.");
    }
});

// Route to show the edit stock page
router.get('/stock/:id', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const productId = req.params.id;

        const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
        if (!product) {
            return res.status(404).send("Product not found.");
        }

        res.render('account/edit-stock', {
            title: "Edit Stock",
            view: 'admin-products',
            product: product
        });
    } catch (err) {
        console.error("Error showing edit stock page:", err);
        res.status(500).send("An error occurred.");
    }
});

// UPDATED: Route to handle the stock AND price update
router.post('/stock/:id', isAdmin, async (req, res) => {
    const productId = req.params.id;
    const { retailPrice, stock: newStockLevels } = req.body;
    const updateQuery = {};

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');

        // Prepare stock level updates
        for (const size in newStockLevels) {
            const quantity = parseInt(newStockLevels[size], 10);
            if (!isNaN(quantity) && quantity >= 0) {
                const safeSizeKey = size.replace('.', '_');
                updateQuery[`stock.${safeSizeKey}`] = quantity;
            }
        }

        // Prepare retail price update
        const newRetailPrice = parseFloat(retailPrice);
        if (!isNaN(newRetailPrice) && newRetailPrice >= 0) {
            updateQuery.retailPrice = newRetailPrice;
        }

        if (Object.keys(updateQuery).length > 0) {
            await productsCollection.updateOne(
                { _id: new ObjectId(productId) },
                { $set: updateQuery }
            );
        }

        res.redirect('/products/manage');

    } catch (err) {
        console.error("--- STOCK/PRICE UPDATE FAILED ---");
        console.error("Timestamp:", new Date().toISOString());
        console.error("Product ID:", productId);
        console.error("Attempted Update Data:", updateQuery);
        console.error("Full Error:", err);
        res.status(500).send("Failed to update stock/price.");
    }
});

// Route to show the "Add a Review" form
router.get('/:sku/review', isLoggedIn, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const ordersCollection = db.collection('orders');
        const { sku } = req.params;

        const product = await productsCollection.findOne({ sku: sku });
        if (!product) {
            return res.status(404).send("Product not found.");
        }

        const hasPurchased = await ordersCollection.findOne({
            "userId": req.session.user.userId,
            "items.sku": sku,
            "status": "Delivered"
        });

        if (!hasPurchased) {
            return res.status(403).render('info-page', {
                title: "Review Not Allowed",
                message: "You can only write a review for products you have purchased and that have been delivered.",
                buttonText: "Back to Product",
                buttonLink: `/products/${sku}`,
                page: 'auth'
            });
        }

        res.render('add-review', {
            title: `Review ${product.name}`,
            product: product,
            page: 'auth'
        });

    } catch (err) {
        console.error("Error showing review page:", err);
        res.status(500).send("An error occurred.");
    }
});

// Route to handle the "Add a Review" form submission
router.post('/:sku/review', isLoggedIn, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const reviewsCollection = db.collection('reviews');
        const { productId, rating, comment } = req.body;
        const { sku } = req.params;

        const newReview = {
            productId: new ObjectId(productId),
            userId: req.session.user.userId,
            rating: parseInt(rating),
            comment: comment,
            createdAt: new Date()
        };

        await reviewsCollection.insertOne(newReview);

        res.redirect(`/products/${sku}`);

    } catch (err) {
        console.error("Error submitting review:", err);
        res.status(500).send("An error occurred while submitting your review.");
    }
});


// Route for a single Product Detail Page (PDP)
router.get('/:sku', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const usersCollection = db.collection('users');
        const reviewsCollection = db.collection('reviews');
        const { sku } = req.params;

        if (['men', 'women', 'search'].includes(sku.toLowerCase())) {
            return res.status(404).send("Page not found.");
        }

        const product = await productsCollection.findOne({ sku: sku });

        if (!product) {
            return res.status(404).send("Product not found");
        }
        
        const [reviews, user, relatedProducts] = await Promise.all([
            reviewsCollection.aggregate([
                { $match: { productId: product._id } },
                { $sort: { createdAt: -1 } },
                { $lookup: { from: 'users', localField: 'userId', foreignField: 'userId', as: 'author' } },
                { $unwind: '$author' }
            ]).toArray(),
            
            req.session.user ? usersCollection.findOne({ userId: req.session.user.userId }) : null,

            productsCollection.find({
                brand: product.brand,
                _id: { $ne: product._id }
            }).limit(8).toArray()
        ]);

        const isWishlisted = user && user.wishlist && user.wishlist.some(id => id.equals(product._id));
        const userWishlist = user ? user.wishlist : [];

        res.render('product-detail', {
            title: product.name,
            product: product,
            isWishlisted: isWishlisted,
            reviews: reviews,
            relatedProducts: relatedProducts,
            wishlist: userWishlist
        });

    } catch (err) {
        console.error("Error fetching product details:", err);
        res.status(500).send("Error loading product page.");
    }
});

module.exports = router;