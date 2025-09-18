// routes/cart.js

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { convertCurrency } = require('./currency');

// GET /cart - Display the shopping cart page
router.get('/', async (req, res) => {
    try {
        const currency = res.locals.locationData.currency;
        let wishlistProducts = [];
        let userWishlist = [];
        let cart = req.session.cart || { items: [], totalQty: 0, totalPrice: 0 };

        if (req.session.user) {
            const db = req.app.locals.client.db(req.app.locals.dbName);
            const usersCollection = db.collection('users');
            const productsCollection = db.collection('products');
            
            const user = await usersCollection.findOne({ userId: req.session.user.userId });
            
            if (user && user.wishlist) {
                userWishlist = user.wishlist;
                if (user.wishlist.length > 0) {
                    wishlistProducts = await productsCollection.find({
                        _id: { $in: user.wishlist }
                    }).limit(4).toArray();
                }
            }
        }

        // Perform currency conversions before rendering
        if (cart.items.length > 0) {
            cart.items = await Promise.all(cart.items.map(async (item) => {
                item.convertedPrice = await convertCurrency(item.price, currency);
                return item;
            }));
            cart.convertedTotalPrice = await convertCurrency(cart.totalPrice, currency);
        }

        if (wishlistProducts.length > 0) {
            wishlistProducts = await Promise.all(wishlistProducts.map(async (product) => {
                product.convertedPrice = await convertCurrency(product.retailPrice, currency);
                return product;
            }));
        }

        res.render('cart', {
            title: "Your Cart",
            cart: cart,
            wishlistProducts: wishlistProducts,
            wishlist: userWishlist
        });

    } catch (err) {
        console.error("Error fetching cart or wishlist data:", err);
        res.status(500).send("An error occurred while loading the cart page.");
    }
});

// UPDATED: POST /cart/add - Now returns JSON instead of redirecting
router.post('/add', async (req, res) => {
    try {
        const { productId, sku, size } = req.body;
        const currency = res.locals.locationData.currency;

        if (!req.session.cart) {
            req.session.cart = {
                items: [],
                totalQty: 0,
                totalPrice: 0
            };
        }
        const cart = req.session.cart;

        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productsCollection = db.collection('products');
        const product = await productsCollection.findOne({ _id: new ObjectId(productId) });

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const itemId = `${sku}_${size}`;
        const existingItemIndex = cart.items.findIndex(item => item.itemId === itemId);
        let addedItem;

        if (existingItemIndex > -1) {
            cart.items[existingItemIndex].qty++;
            cart.items[existingItemIndex].price = cart.items[existingItemIndex].qty * product.retailPrice;
            addedItem = cart.items[existingItemIndex];
        } else {
            addedItem = {
                itemId: itemId,
                productId: product._id,
                sku: product.sku,
                name: product.name,
                brand: product.brand,
                thumbnailUrl: product.thumbnailUrl,
                size: size,
                unitPrice: product.retailPrice,
                qty: 1,
                price: product.retailPrice
            };
            cart.items.push(addedItem);
        }

        cart.totalQty = cart.items.reduce((total, item) => total + item.qty, 0);
        cart.totalPrice = cart.items.reduce((total, item) => total + item.price, 0);
        
        const convertedPrice = await convertCurrency(addedItem.price, currency);

        res.json({
            success: true,
            message: 'Item added to cart!',
            cart: cart,
            addedItem: {
                ...addedItem,
                convertedPrice: convertedPrice
            }
        });

    } catch (err) {
        console.error("Error adding to cart:", err);
        res.status(500).json({ success: false, message: 'An error occurred.' });
    }
});

// POST /cart/remove - Remove an item from the shopping cart
router.post('/remove', (req, res) => {
    const { itemId } = req.body;
    const cart = req.session.cart;

    if (cart && cart.items) {
        cart.items = cart.items.filter(item => item.itemId !== itemId);
        cart.totalQty = cart.items.reduce((total, item) => total + item.qty, 0);
        cart.totalPrice = cart.items.reduce((total, item) => total + item.price, 0);
    }
    
    res.redirect('/cart');
});

// ADDED: POST /cart/update-quantity - Increment or decrement an item's quantity
router.post('/update-quantity', (req, res) => {
    const { itemId, change } = req.body; // change will be '1' or '-1'
    const cart = req.session.cart;
    const changeAmount = parseInt(change, 10);

    if (cart && cart.items && !isNaN(changeAmount)) {
        const itemIndex = cart.items.findIndex(item => item.itemId === itemId);
        if (itemIndex > -1) {
            const item = cart.items[itemIndex];
            item.qty += changeAmount;

            // Remove item if quantity drops to 0 or less
            if (item.qty <= 0) {
                cart.items.splice(itemIndex, 1);
            } else {
                item.price = item.qty * item.unitPrice;
            }
        }

        cart.totalQty = cart.items.reduce((total, item) => total + item.qty, 0);
        cart.totalPrice = cart.items.reduce((total, item) => total + item.price, 0);
    }

    res.redirect('/cart');
});

// ADDED: POST /cart/move-to-wishlist - Move an item from cart to wishlist
router.post('/move-to-wishlist', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/users/login');
    }
    try {
        const { itemId, productId } = req.body;
        const userId = req.session.user.userId;
        const productObjectId = new ObjectId(productId);
        const cart = req.session.cart;

        // Add to wishlist
        const db = req.app.locals.client.db(req.app.locals.dbName);
        await db.collection('users').updateOne(
            { userId: userId },
            { $addToSet: { wishlist: productObjectId } } // Use $addToSet to avoid duplicates
        );

        // Remove from cart
        if (cart && cart.items) {
            cart.items = cart.items.filter(item => item.itemId !== itemId);
            cart.totalQty = cart.items.reduce((total, item) => total + item.qty, 0);
            cart.totalPrice = cart.items.reduce((total, item) => total + item.price, 0);
        }
        
        res.redirect('/cart');

    } catch (err) {
        console.error("Error moving item to wishlist:", err);
        res.status(500).send("An error occurred.");
    }
});

module.exports = router;