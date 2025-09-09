const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

// GET /cart - Display the shopping cart page
router.get('/', (req, res) => {
    if (!req.session.cart) {
        return res.render('cart', {
            title: "Your Cart",
            cart: { items: [], totalQty: 0, totalPrice: 0 }
        });
    }
    res.render('cart', {
        title: "Your Cart",
        cart: req.session.cart
    });
});

// POST /cart/add - Add an item to the shopping cart
router.post('/add', async (req, res) => {
    try {
        const { productId, sku, size, buyNow } = req.body;

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
            return res.status(404).send('Product not found');
        }

        const itemId = `${sku}_${size}`;
        const existingItemIndex = cart.items.findIndex(item => item.itemId === itemId);

        if (existingItemIndex > -1) {
            cart.items[existingItemIndex].qty++;
            cart.items[existingItemIndex].price = cart.items[existingItemIndex].qty * product.retailPrice;
        } else {
            cart.items.push({
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
            });
        }

        cart.totalQty = cart.items.reduce((total, item) => total + item.qty, 0);
        cart.totalPrice = cart.items.reduce((total, item) => total + item.price, 0);

        // Redirect to checkout if "Buy Now" was clicked
        if (buyNow === 'true') {
            return res.redirect('/checkout');
        }

        res.redirect('/cart');

    } catch (err) {
        console.error("Error adding to cart:", err);
        res.status(500).send("An error occurred while adding the item to your cart.");
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

// NEW: POST /cart/update - Update an item's quantity
router.post('/update', (req, res) => {
    const { itemId, newQty } = req.body;
    const cart = req.session.cart;
    const quantity = parseInt(newQty);

    if (cart && cart.items && quantity > 0) {
        const itemIndex = cart.items.findIndex(item => item.itemId === itemId);
        if (itemIndex > -1) {
            const item = cart.items[itemIndex];
            item.qty = quantity;
            item.price = item.qty * item.unitPrice; // Recalculate price for this item
        }

        // Recalculate cart totals
        cart.totalQty = cart.items.reduce((total, item) => total + item.qty, 0);
        cart.totalPrice = cart.items.reduce((total, item) => total + item.price, 0);
    }

    res.redirect('/cart');
});

module.exports = router;