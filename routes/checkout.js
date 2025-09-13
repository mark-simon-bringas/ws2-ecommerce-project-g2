const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// GET /checkout - Display the main checkout page
router.get('/', (req, res) => {
    if (!req.session.cart || req.session.cart.items.length === 0) {
        return res.redirect('/cart');
    }
    res.render('checkout', {
        title: "Checkout",
        cart: req.session.cart
    });
});

// UPDATED: /checkout/place-order to handle stock decrement with dot replacement
router.post('/place-order', async (req, res) => {
    if (!req.session.cart || req.session.cart.items.length === 0) {
        return res.redirect('/cart');
    }

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const productsCollection = db.collection('products');
        const cart = req.session.cart;

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
            total: cart.totalPrice,
            orderDate: new Date(),
            status: 'Processing'
        };

        if (req.session.user) {
            order.userId = req.session.user.userId;
        }

        const result = await ordersCollection.insertOne(order);
        order._id = result.insertedId;

        // FIXED: Decrement stock using underscore format for sizes
        const stockUpdates = cart.items.map(item => {
            const safeSizeKey = item.size.replace('.', '_');
            const updateField = `stock.${safeSizeKey}`;
            return productsCollection.updateOne(
                { _id: new ObjectId(item.productId) },
                { $inc: { [updateField]: -item.qty } }
            );
        });
        await Promise.all(stockUpdates);


        // --- AUTOMATICALLY SEND ORDER CONFIRMATION EMAIL ---
        const itemsHtml = order.items.map(item => `
            <tr style="border-bottom: 1px solid #eaeaea;">
                <td style="padding: 15px 0;">${item.name} (Size: ${item.size})</td>
                <td style="padding: 15px 0; text-align: center;">${item.qty}</td>
                <td style="padding: 15px 0; text-align: right;">${item.price.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
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
                                <td style="padding: 20px 0 0; text-align: right;"><strong>${order.total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</strong></td>
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
                        <p>&copy; ${new Date().getFullYear()} sneakslab. All rights reserved.</p>
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
        res.status(500).send("Could not retrieve order confirmation.");
    }
});

module.exports = router;