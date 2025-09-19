// routes/checkout.js

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { Resend } = require('resend');
const { convertCurrency } = require('./currency');

const resend = new Resend(process.env.RESEND_API_KEY);

// Define shipping constants (using USD as the base currency)
const SHIPPING_COST_BASE = 5; // e.g., $5 shipping
const FREE_SHIPPING_THRESHOLD_BASE = 150; // e.g., free shipping on orders over $150

// Helper function for date formatting
const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// GET /checkout - Display the main checkout page
router.get('/', async (req, res) => {
    if (!req.session.cart || req.session.cart.items.length === 0) {
        return res.redirect('/cart');
    }

    const currency = res.locals.locationData.currency;
    const cart = req.session.cart;

    // --- Shipping & Total Logic ---
    let shippingCost = (cart.totalPrice >= FREE_SHIPPING_THRESHOLD_BASE) ? 0 : SHIPPING_COST_BASE;
    const totalWithShipping = cart.totalPrice + shippingCost;
    const amountNeededForFreeShipping = FREE_SHIPPING_THRESHOLD_BASE - cart.totalPrice;
    const freeShippingProgress = (cart.totalPrice / FREE_SHIPPING_THRESHOLD_BASE) * 100;

    // --- Arrival Date Logic ---
    const today = new Date();
    const arrivalStart = new Date(today);
    arrivalStart.setDate(today.getDate() + 5);
    const arrivalEnd = new Date(today);
    arrivalEnd.setDate(today.getDate() + 7);
    const arrivalDate = `Arrives ${arrivalStart.toLocaleDateString('en-US', { weekday: 'short' })}, ${formatDate(arrivalStart)} - ${arrivalEnd.toLocaleDateString('en-US', { weekday: 'short' })}, ${formatDate(arrivalEnd)}`;

    // Perform currency conversion for all cart and summary items
    if (cart.items.length > 0) {
        cart.items = await Promise.all(cart.items.map(async (item) => {
            item.convertedPrice = await convertCurrency(item.price, currency);
            return item;
        }));
        cart.convertedTotalPrice = await convertCurrency(cart.totalPrice, currency);
    }
    
    const convertedShipping = {
        cost: await convertCurrency(shippingCost, currency),
        threshold: await convertCurrency(FREE_SHIPPING_THRESHOLD_BASE, currency),
        amountNeeded: await convertCurrency(amountNeededForFreeShipping, currency),
        progress: freeShippingProgress > 100 ? 100 : freeShippingProgress
    };

    res.render('checkout', {
        title: "Checkout",
        cart: cart,
        shipping: convertedShipping,
        totalWithShipping: await convertCurrency(totalWithShipping, currency),
        arrivalDate: arrivalDate
    });
});


// POST /checkout/place-order - Handle the order submission
router.post('/place-order', async (req, res) => {
    if (!req.session.cart || req.session.cart.items.length === 0) {
        return res.redirect('/cart');
    }

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const productsCollection = db.collection('products');
        const cart = req.session.cart;
        const currency = res.locals.locationData.currency;

        // Recalculate shipping on the backend to ensure accuracy
        const finalShippingCost = (cart.totalPrice >= FREE_SHIPPING_THRESHOLD_BASE) ? 0 : SHIPPING_COST_BASE;
        const finalTotal = cart.totalPrice + finalShippingCost;

        // Create the order object
        const order = {
            customer: {
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
            },
            shippingAddress: {
                address: req.body.address,
                country: req.body.country,
                state: req.body.state,
                zip: req.body.zip
            },
            items: cart.items,
            subtotal: cart.totalPrice, // Store subtotal in base currency
            shippingCost: finalShippingCost, // Store shipping cost in base currency
            total: finalTotal, // Store final total in base currency
            currency: currency, // Store the currency of the transaction
            convertedTotal: await convertCurrency(finalTotal, currency), // Store the converted total for records
            orderDate: new Date(),
            status: 'Processing',
            isNew: true 
        };

        // If the user is logged in, attach their ID to the order
        if (req.session.user) {
            order.userId = req.session.user.userId;
        }

        // Save the order to the database
        const result = await ordersCollection.insertOne(order);
        order._id = result.insertedId; // Attach the new ID to the order object for the email

        // Decrement stock for each item in the order
        const stockUpdates = cart.items.map(item => {
            const safeSizeKey = item.size.replace('.', '_');
            const updateField = `stock.${safeSizeKey}`;
            return productsCollection.updateOne(
                { _id: new ObjectId(item.productId) },
                { $inc: { [updateField]: -item.qty } } 
            );
        });
        await Promise.all(stockUpdates);

        // --- AUTOMATICALLY SEND ORDER CONFIRMATION EMAIL (with converted currency) ---
        const itemsWithConvertedPrice = await Promise.all(order.items.map(async item => {
            const convertedPrice = await convertCurrency(item.price, currency);
            return { ...item, convertedPrice };
        }));

        const itemsHtml = itemsWithConvertedPrice.map(item => `
            <tr style="border-bottom: 1px solid #eaeaea;">
                <td style="padding: 15px 0;">${item.name} (Size: ${item.size})</td>
                <td style="padding: 15px 0; text-align: center;">${item.qty}</td>
                <td style="padding: 15px 0; text-align: right;">${item.convertedPrice.toLocaleString(undefined, { style: 'currency', currency: currency })}</td>
            </tr>
        `).join('');

        const confirmationEmailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f7; }
                    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; padding: 40px; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .header h1 { color: #1d1d1f; margin: 0; }
                    .details p { margin: 5px 0; color: #6e6e73; }
                    .details strong { color: #1d1d1f; }
                    .items-table { width: 100%; border-collapse: collapse; margin: 30px 0; }
                    .items-table th { text-align: left; color: #6e6e73; font-weight: 500; padding-bottom: 10px; border-bottom: 2px solid #eaeaea; }
                    .items-table tfoot strong { color: #1d1d1f; font-size: 1.2em; }
                    .address h3 { margin-bottom: 10px; color: #1d1d1f; }
                    .footer { text-align: center; margin-top: 30px; color: #86868b; font-size: 0.8em; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>sneakslab</h1>
                        <p style="font-size: 1.2em; color: #1d1d1f; margin-top: 10px;">Thank you for your order!</p>
                    </div>
                    <div class="details">
                        <p><strong>Order ID:</strong> ${order._id}</p>
                        <p><strong>Order Date:</strong> ${new Date(order.orderDate).toLocaleDateString()}</p>
                    </div>
                    <table class="items-table">
                        <thead>
                            <tr>
                                <th style="width: 60%;">Item</th>
                                <th style="text-align: center;">Qty</th>
                                <th style="text-align: right;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="2" style="padding: 20px 0 0; text-align: right;"><strong>Total</strong></td>
                                <td style="padding: 20px 0 0; text-align: right;"><strong>${order.convertedTotal.toLocaleString(undefined, { style: 'currency', currency: currency })}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                    <div class="address">
                        <h3>Shipping to:</h3>
                        <p style="color: #6e6e73;">
                            ${order.customer.firstName} ${order.customer.lastName}<br>
                            ${order.shippingAddress.address}<br>
                            ${order.shippingAddress.state}, ${order.shippingAddress.zip}
                        </p>
                    </div>
                    <div class="footer">
                        <p>&copy; ${new Date().getFullYear()} Sneakslab. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: order.customer.email,
            subject: `Your sneakslab Order Confirmation #${order._id.toString().slice(-6)}`,
            html: confirmationEmailHtml,
        });

        req.session.cart = null;

        res.redirect(`/checkout/success/${result.insertedId}`);

    } catch (err) {
        console.error("Error placing order:", err);
        res.status(500).send("An error occurred while placing your order.");
    }
});

// GET /checkout/success/:orderId - Display the order confirmation page
router.get('/success/:orderId', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const orderId = req.params.orderId;

        const order = await ordersCollection.findOne({ _id: new ObjectId(orderId) });

        if (!order) {
            return res.status(404).send("Order not found.");
        }

        res.render('order-success', {
            title: "Order Confirmation",
            order: order
        });

    } catch (err) {
        console.error("Error fetching order confirmation:", err);
        res.status(500).send("An error occurred while retrieving order confirmation.");
    }
});

module.exports = router;