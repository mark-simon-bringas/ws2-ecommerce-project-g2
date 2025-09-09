const express = require('express');
const router = express.Router();
const axios = require('axios');
const { ObjectId } = require('mongodb');

// GET /products - The main shop page with filtering
router.get('/', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');

        let query = {};
        let sort = {};
        let pageTitle = "Shop All";

        // Handle category filtering
        if (req.query.category) {
            query.gender = req.query.category;
            pageTitle = `${req.query.category.charAt(0).toUpperCase() + req.query.category.slice(1)}'s Collection`;
        }
        
        // Handle brand filtering
        if (req.query.brand) {
            query.brand = req.query.brand;
            pageTitle = `${req.query.brand} Collection`;
        }

        // Handle new arrivals filtering
        if (req.query.new === 'true') {
            sort = { importedAt: -1 };
            pageTitle = "New Arrivals";
        }

        const products = await productsCollection.find(query).sort(sort).toArray();
        
        res.render('shop', { 
            title: pageTitle,
            pageTitle: pageTitle, // For displaying a heading on the page
            products: products 
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
        const searchQuery = req.query.q || "";

        // Use a regular expression for a case-insensitive search on name and brand
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
            products: products
        });

    } catch (err) {
        console.error("Error searching products:", err);
        res.status(500).send("Error performing search.");
    }
});


// Route to display the admin product management page
router.get('/manage', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied.");
    }
    
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

// REVAMPED route to handle the search form submission with filters
router.post('/search', async (req, res) => {
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
        const response = await axios.request(options);
        const products = response.data.results;
        let html = '';

        if (products && products.length > 0) {
            products.forEach(product => {
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
            html = `<div class="col-12"><div class="text-center p-5 bg-light rounded"><p class="lead text-body-secondary">No results found for your search.</p></div></div>`;
        }
        res.send(html);
    } catch (error) {
        console.error("API call failed:", error.response ? error.response.data : error.message);
        const errorHtml = `<div class="col-12"><div class="alert alert-danger">API request failed. Please check the server console for details.</div></div>`;
        res.status(500).send(errorHtml);
    }
});

// Route to handle bulk importing of multiple products
router.post('/import-multiple', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        let { selectedProducts } = req.body;
        if (!selectedProducts) { return res.redirect('/products/manage'); }
        if (!Array.isArray(selectedProducts)) { selectedProducts = [selectedProducts]; }

        const productsToInsert = [];
        const skusToInsert = [];

        selectedProducts.forEach(productString => {
            const product = JSON.parse(productString);
            productsToInsert.push({
                name: product.name, sku: product.sku, brand: product.brand,
                gender: product.gender, // Added gender for filtering
                retailPrice: Number(product.retailPrice), imageUrl: product.image.original,
                thumbnailUrl: product.image.thumbnail, importedAt: new Date()
            });
            skusToInsert.push(product.sku);
        });

        const existingProducts = await productsCollection.find({ sku: { $in: skusToInsert } }).project({ sku: 1 }).toArray();
        const existingSkus = existingProducts.map(p => p.sku);
        const newProducts = productsToInsert.filter(p => !existingSkus.includes(p.sku));

        if (newProducts.length > 0) {
            await productsCollection.insertMany(newProducts);
        }
        res.redirect('/products/manage');
    } catch (err) {
        console.error("Error importing multiple products:", err);
        res.status(500).send("An error occurred during the bulk import.");
    }
});

// Route to delete a single product
router.post('/delete', async (req, res) => {
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

// NEW: Route to handle bulk deletion of multiple products
router.post('/delete-multiple', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        let { productIds } = req.body;

        if (!productIds) {
            return res.redirect('/products/manage');
        }
        // Ensure productIds is an array, even if only one is selected
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

// Route for a single Product Detail Page (PDP)
router.get('/:sku', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const { sku } = req.params;

        // This check prevents "men" or "women" from being treated as a SKU
        if (['men', 'women', 'search'].includes(sku.toLowerCase())) {
            return res.status(404).send("Page not found."); // Prevent route collision
        }

        const product = await productsCollection.findOne({ sku: sku });

        if (!product) {
            return res.status(404).send("Product not found");
        }

        res.render('product-detail', {
            title: product.name,
            product: product,
            currentUser: req.session.user
        });

    } catch (err) {
        console.error("Error fetching product details:", err);
        res.status(500).send("Error loading product page.");
    }
});

module.exports = router;