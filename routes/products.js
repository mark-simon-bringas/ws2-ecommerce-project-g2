// routes/products.js

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { ObjectId } = require('mongodb');
const { convertCurrency } = require('./currency');

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
        const currency = res.locals.locationData.currency;

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
        
        const productsWithConvertedPrices = await Promise.all(products.map(async (product) => {
            product.convertedPrice = await convertCurrency(product.retailPrice, currency);
            return product;
        }));

        res.render('shop', { 
            title: pageTitle,
            pageTitle: pageTitle,
            products: productsWithConvertedPrices,
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
        const currency = res.locals.locationData.currency;

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

        const productsWithConvertedPrices = await Promise.all(products.map(async (product) => {
            product.convertedPrice = await convertCurrency(product.retailPrice, currency);
            return product;
        }));

        res.render('shop', {
            title: pageTitle,
            pageTitle: pageTitle,
            products: productsWithConvertedPrices,
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
        
        const { q, brand, sort } = req.query;
        let query = {};
        let sortQuery = { importedAt: -1 };

        if (q) {
            query.$or = [
                { name: { $regex: q, $options: 'i' } },
                { sku: { $regex: q, $options: 'i' } }
            ];
        }
        if (brand) {
            query.brand = brand;
        }

        if (sort) {
            switch (sort) {
                case 'date-asc': sortQuery = { importedAt: 1 }; break;
                case 'name-asc': sortQuery = { name: 1 }; break;
                case 'name-desc': sortQuery = { name: -1 }; break;
                case 'price-asc': sortQuery = { retailPrice: 1 }; break;
                case 'price-desc': sortQuery = { retailPrice: -1 }; break;
                default: sortQuery = { importedAt: -1 };
            }
        }

        const localProductsPromise = productsCollection.find(query).sort(sortQuery).toArray();

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
            apiProducts: apiResponse.data.results,
            filters: req.query
        });

    } catch (error) {
        console.error("Data fetching for manage page failed:", error.response ? error.response.data : error.message);
        res.render('admin-products', {
            title: "Manage Products",
            view: 'admin-products',
            user: req.session.user,
            currentUser: req.session.user,
            localProducts: [],
            apiProducts: [],
            filters: {}
        });
    }
});

// UPDATED: Route now handles the hasDescription filter
router.post('/search', isAdmin, async (req, res) => {
    const { query, brand, gender, hasDescription } = req.body;

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
        params: { limit: '50', query: fullQuery },
        headers: {
            'X-RapidAPI-Key': process.env.SNEAKER_DB_API_KEY,
            'X-RapidAPI-Host': 'the-sneaker-database.p.rapidapi.com'
        }
    };

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');

        const response = await axios.request(options);
        let apiProducts = response.data.results;

        // Filter results if the checkbox was checked
        if (hasDescription === 'true') {
            apiProducts = apiProducts.filter(product => product.story && product.story.trim() !== '');
        }

        const existingProducts = await productsCollection.find().project({ sku: 1, _id: 0 }).toArray();
        const existingSkus = new Set(existingProducts.map(p => p.sku));

        const newProducts = apiProducts.filter(p => !existingSkus.has(p.sku));

        let html = '';
        if (newProducts && newProducts.length > 0) {
            newProducts.forEach(product => {
                html += `
                    <div class="col">
                        <div class="card h-100 shadow-sm product-import-card">
                            <input type="checkbox" name="selectedProducts" class="product-checkbox form-check-input" value="${product.id}">
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

// Route now receives 'id's and fetches details with the correct endpoint
router.post('/import-multiple', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const activityLogCollection = db.collection('activity_log');
        let { selectedProducts: selectedIds } = req.body; // Renamed for clarity
        if (!selectedIds) { return res.redirect('/products/manage'); }
        if (!Array.isArray(selectedIds)) { selectedIds = [selectedIds]; }

        const productsToInsert = [];
        const standardSizes = ['8', '8.5', '9', '9.5', '10', '10.5', '11', '12'];

        for (const id of selectedIds) {
            try {
                // Fetch full product details using the correct 'id'
                const options = {
                    method: 'GET',
                    url: `https://the-sneaker-database.p.rapidapi.com/sneakers/${id}`,
                     headers: {
                        'X-RapidAPI-Key': process.env.SNEAKER_DB_API_KEY,
                        'X-RapidAPI-Host': 'the-sneaker-database.p.rapidapi.com'
                    }
                };
                const response = await axios.request(options);
                const product = response.data.results[0];

                if (!product) continue;

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
                    stock: initialStock,
                    description: product.story || 'No description available.',
                    colorway: product.colorway,
                    releaseDate: product.releaseDate
                });
            } catch (err) {
                console.warn(`Could not fetch details for ID ${id}. Skipping import. Error: ${err.message}`);
                continue;
            }
        }

        if (productsToInsert.length > 0) {
            await productsCollection.insertMany(productsToInsert);

            const logEntry = {
                userId: req.session.user.userId,
                userFirstName: req.session.user.firstName,
                userRole: req.session.user.role,
                actionType: 'PRODUCT_IMPORT',
                details: {
                    productCount: productsToInsert.length
                },
                timestamp: new Date()
            };
            await activityLogCollection.insertOne(logEntry);
        }
        res.redirect('/products/manage');
    } catch (err) {
        console.error("Error during the final stage of import:", err);
        res.status(500).send("An error occurred during the bulk import.");
    }
});


// Route to delete a single product and log the action
router.post('/delete', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const activityLogCollection = db.collection('activity_log');
        const { productId } = req.body;

        const productToDelete = await productsCollection.findOne({ _id: new ObjectId(productId) });

        if (productToDelete) {
            await productsCollection.deleteOne({ _id: new ObjectId(productId) });

            const logEntry = {
                userId: req.session.user.userId,
                userFirstName: req.session.user.firstName,
                userRole: req.session.user.role,
                actionType: 'PRODUCT_DELETE',
                details: {
                    productName: productToDelete.name,
                    productSku: productToDelete.sku
                },
                timestamp: new Date()
            };
            await activityLogCollection.insertOne(logEntry);
        }

        res.redirect('/products/manage');
    } catch (err) {
        console.error("Error deleting product:", err);
        res.status(500).send("An error occurred while deleting the product.");
    }
});

// Route to handle bulk deletion and log the action
router.post('/delete-multiple', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const activityLogCollection = db.collection('activity_log');
        let { productIds } = req.body;

        if (!productIds) {
            return res.redirect('/products/manage');
        }
        if (!Array.isArray(productIds)) {
            productIds = [productIds];
        }

        const objectIdsToDelete = productIds.map(id => new ObjectId(id));
        
        const productsToDelete = await productsCollection.find({ _id: { $in: objectIdsToDelete } }).toArray();

        if (productsToDelete.length > 0) {
            await productsCollection.deleteMany({ _id: { $in: objectIdsToDelete } });

            const logEntry = {
                userId: req.session.user.userId,
                userFirstName: req.session.user.firstName,
                userRole: req.session.user.role,
                actionType: 'PRODUCT_DELETE_MULTIPLE',
                details: {
                    productCount: productsToDelete.length,
                    deletedProducts: productsToDelete.map(p => ({ name: p.name, sku: p.sku }))
                },
                timestamp: new Date()
            };
            await activityLogCollection.insertOne(logEntry);
        }

        res.redirect('/products/manage');

    } catch (err) {
        console.error("Error deleting multiple products:", err);
        res.status(500).send("An error occurred during the bulk delete.");
    }
});

// Route to show the edit stock and price page
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

// Route to handle the stock and price update
router.post('/stock/:id', isAdmin, async (req, res) => {
    const productId = req.params.id;
    const { retailPrice, stock: newStockLevels } = req.body;
    const updateQuery = {};

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const activityLogCollection = db.collection('activity_log');

        const productBeforeUpdate = await productsCollection.findOne({ _id: new ObjectId(productId) });

        for (const size in newStockLevels) {
            const quantity = parseInt(newStockLevels[size], 10);
            if (!isNaN(quantity) && quantity >= 0) {
                const safeSizeKey = size.replace('.', '_');
                updateQuery[`stock.${safeSizeKey}`] = quantity;
            }
        }

        const newRetailPrice = parseFloat(retailPrice);
        if (retailPrice && !isNaN(newRetailPrice) && newRetailPrice >= 0) {
            updateQuery.retailPrice = newRetailPrice;

            if (productBeforeUpdate && productBeforeUpdate.retailPrice !== newRetailPrice) {
                const logEntry = {
                    userId: req.session.user.userId,
                    userFirstName: req.session.user.firstName,
                    userRole: req.session.user.role,
                    actionType: 'PRICE_UPDATE',
                    details: {
                        productId: productBeforeUpdate._id,
                        productName: productBeforeUpdate.name,
                        oldPrice: productBeforeUpdate.retailPrice,
                        newPrice: newRetailPrice
                    },
                    timestamp: new Date()
                };
                await activityLogCollection.insertOne(logEntry);
            }
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
        const currency = res.locals.locationData.currency;

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

        // Convert all prices before rendering
        product.convertedPrice = await convertCurrency(product.retailPrice, currency);
        const relatedProductsWithConvertedPrices = await Promise.all(relatedProducts.map(async (p) => {
            p.convertedPrice = await convertCurrency(p.retailPrice, currency);
            return p;
        }));

        res.render('product-detail', {
            title: product.name,
            product: product,
            isWishlisted: isWishlisted,
            reviews: reviews,
            relatedProducts: relatedProductsWithConvertedPrices,
            wishlist: userWishlist
        });

    } catch (err) {
        console.error("Error fetching product details:", err);
        res.status(500).send("Error loading product page.");
    }
});


module.exports = router;