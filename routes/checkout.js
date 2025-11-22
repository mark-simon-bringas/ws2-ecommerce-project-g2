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

    const db = req.app.locals.client.db(req.app.locals.dbName);
    const currency = res.locals.locationData.currency;
    const cart = req.session.cart;
    let userAddresses = [];

    // Fetch User Addresses
    if (req.session.user) {
        const user = await db.collection('users').findOne({ userId: req.session.user.userId });
        if (user && user.addresses) {
            userAddresses = user.addresses;
        }
    }

    // --- Fetch User Vouchers for "Wallet" ---
    let availableVouchers = [];
    if (req.session.user) {
        const user = await db.collection('users').findOne({ userId: req.session.user.userId });
        if (user && user.vouchers) {
            // Filter for vouchers that are NOT used
            const voucherIds = user.vouchers.filter(v => !v.isUsed).map(v => v.voucherId);
            
            if (voucherIds.length > 0) {
                // Fetch details for those vouchers, ensuring they are active and not expired
                availableVouchers = await db.collection('vouchers').find({ 
                    _id: { $in: voucherIds }, 
                    isActive: true,
                    expiryDate: { $gt: new Date() }
                }).toArray();
            }
        }
    }

    // Calculate Totals & Discount
    let subtotal = cart.totalPrice;
    let discountAmount = 0;

    // Apply Voucher if present in session
    if (cart.voucher) {
        if (cart.voucher.type === 'percentage') {
            discountAmount = subtotal * (cart.voucher.value / 100);
        } else {
            discountAmount = cart.voucher.value;
        }
    }
    // Prevent negative total
    if (discountAmount > subtotal) discountAmount = subtotal;

    const now = new Date();
    const activeSale = await db.collection('sales').findOne({
        startDate: { $lte: now },
        endDate: { $gte: now }
    });
    
    // Shipping Logic
    let shippingCost = (activeSale || subtotal >= FREE_SHIPPING_THRESHOLD_BASE) ? 0 : SHIPPING_COST_BASE;
    
    // Final Total Calculation
    let totalWithShipping = subtotal - discountAmount + shippingCost;
    
    const amountNeededForFreeShipping = FREE_SHIPPING_THRESHOLD_BASE - subtotal;
    const freeShippingProgress = (subtotal / FREE_SHIPPING_THRESHOLD_BASE) * 100;

    // --- Arrival Date Logic ---
    const today = new Date();
    const arrivalStart = new Date(today);
    arrivalStart.setDate(today.getDate() + 5);
    const arrivalEnd = new Date(today);
    arrivalEnd.setDate(today.getDate() + 7);
    const arrivalDate = `Arrives ${arrivalStart.toLocaleDateString('en-US', { weekday: 'short' })}, ${formatDate(arrivalStart)} - ${arrivalEnd.toLocaleDateString('en-US', { weekday: 'short' })}, ${formatDate(arrivalEnd)}`;

    // Convert Cart Items Prices (for Display)
    if (cart.items.length > 0) {
        cart.items = await Promise.all(cart.items.map(async (item) => {
            item.convertedPrice = await convertCurrency(item.price, currency);
            return item;
        }));
        cart.convertedTotalPrice = await convertCurrency(cart.totalPrice, currency);
    }
    
    // Convert Financials (for Display)
    const convertedShipping = {
        cost: await convertCurrency(shippingCost, currency),
        threshold: await convertCurrency(FREE_SHIPPING_THRESHOLD_BASE, currency),
        amountNeeded: await convertCurrency(amountNeededForFreeShipping, currency),
        progress: freeShippingProgress > 100 ? 100 : freeShippingProgress
    };
    const convertedTotalWithShipping = await convertCurrency(totalWithShipping, currency);
    const convertedDiscount = await convertCurrency(discountAmount, currency);

    res.render('checkout', {
        title: "Checkout",
        cart: cart,
        shipping: convertedShipping,
        totalWithShipping: convertedTotalWithShipping,
        arrivalDate: arrivalDate,
        addresses: userAddresses,
        availableVouchers: availableVouchers,
        discountAmount: convertedDiscount,
        appliedVoucher: cart.voucher
    });
});

// POST /checkout/apply-voucher
router.post('/apply-voucher', async (req, res) => {
    const { code } = req.body;
    const db = req.app.locals.client.db(req.app.locals.dbName);
    
    try {
        const voucher = await db.collection('vouchers').findOne({ code: code.toUpperCase(), isActive: true });

        if (!voucher) {
            return res.json({ success: false, message: "Invalid voucher code." });
        }
        if (new Date(voucher.expiryDate) < new Date()) {
            return res.json({ success: false, message: "This voucher has expired." });
        }

        const cart = req.session.cart;
        // Check minimum spend requirement
        if (cart.totalPrice < voucher.minOrderAmount) {
            return res.json({ success: false, message: `Minimum spend of $${voucher.minOrderAmount} required.` });
        }
        
        // If it's a user-specific voucher (Welcome/New User), verify user owns it
        if (voucher.isNewUser && req.session.user) {
            const user = await db.collection('users').findOne({ userId: req.session.user.userId });
            const hasVoucher = user.vouchers.some(v => v.voucherId.equals(voucher._id) && !v.isUsed);
            if (!hasVoucher) {
                return res.json({ success: false, message: "This voucher is not valid for your account or has been used." });
            }
        }

        // Store voucher in session
        req.session.cart.voucher = {
            _id: voucher._id,
            code: voucher.code,
            type: voucher.discountType,
            value: voucher.discountValue
        };
        
        res.json({ success: true });

    } catch (err) {
        console.error("Voucher application error:", err);
        res.json({ success: false, message: "Server error applying voucher." });
    }
});

// POST /checkout/remove-voucher
router.post('/remove-voucher', (req, res) => {
    if (req.session.cart && req.session.cart.voucher) {
        delete req.session.cart.voucher;
    }
    res.json({ success: true });
});

// POST /checkout/place-order - Handle the order submission
router.post('/place-order', async (req, res) => {
    if (!req.session.cart || req.session.cart.items.length === 0) {
        return res.redirect('/cart');
    }

    try {
        const { v4: uuidv4 } = await import('uuid');
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const productsCollection = db.collection('products');
        const usersCollection = db.collection('users');
        const cart = req.session.cart;
        const currency = res.locals.locationData.currency;

        let shippingAddress;
        let billingAddress;
        const { selectedAddressId, saveAddress, sameAsShipping } = req.body;
        const paymentMethod = req.body['payment-method'];

        // Handle Address Selection
        if (req.session.user && selectedAddressId && selectedAddressId !== 'new') {
            const user = await usersCollection.findOne({ userId: req.session.user.userId });
            const savedAddress = user.addresses.find(addr => addr.addressId === selectedAddressId);
            if (savedAddress) {
                shippingAddress = savedAddress;
            }
        } else {
            shippingAddress = {
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                address: req.body.address,
                country: req.body.country,
                state: req.body.state,
                zip: req.body.zip,
                phone: req.body.phone
            };
            if (req.session.user && saveAddress === 'on') {
                const newAddressForProfile = { ...shippingAddress, addressId: uuidv4(), isDefault: false };
                await usersCollection.updateOne(
                    { userId: req.session.user.userId },
                    { $push: { addresses: newAddressForProfile } }
                );
            }
        }

        if (sameAsShipping === 'on') {
            billingAddress = { ...shippingAddress };
        } else {
            billingAddress = {
                address: req.body['billing-address'],
                country: req.body['billing-country'],
                state: req.body['billing-state'],
                zip: req.body['billing-zip']
            };
        }

        // Handle Payment Method Details
        let paymentDetails = { method: 'Unknown' };
        if (paymentMethod === 'cc') {
            const ccNumber = req.body['cc-number'] || '';
            paymentDetails.method = 'Credit Card';
            paymentDetails.last4 = ccNumber.slice(-4);
        } else if (paymentMethod === 'cod') {
            paymentDetails.method = 'Cash on Delivery';
        } else if (paymentMethod) {
            paymentDetails.method = paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1);
        }
        
        // Final Total Calculation with Vouchers & Shipping
        let subtotal = cart.totalPrice;
        let discountAmount = 0;

        if (cart.voucher) {
            if (cart.voucher.type === 'percentage') {
                discountAmount = subtotal * (cart.voucher.value / 100);
            } else {
                discountAmount = cart.voucher.value;
            }
        }
        if (discountAmount > subtotal) discountAmount = subtotal;

        const now = new Date();
        const activeSale = await db.collection('sales').findOne({
            startDate: { $lte: now },
            endDate: { $gte: now }
        });

        const finalShippingCost = (activeSale || subtotal >= FREE_SHIPPING_THRESHOLD_BASE) ? 0 : SHIPPING_COST_BASE;
        const finalTotal = subtotal - discountAmount + finalShippingCost;

        const order = {
            customer: {
                firstName: shippingAddress.firstName,
                lastName: shippingAddress.lastName,
                email: req.body.email,
            },
            shippingAddress: shippingAddress,
            billingAddress: billingAddress,
            paymentDetails: paymentDetails,
            items: cart.items,
            subtotal: subtotal,
            discount: discountAmount, // Store discount amount
            voucherCode: cart.voucher ? cart.voucher.code : null, // Store used code
            shippingCost: finalShippingCost,
            total: finalTotal,
            currency: currency,
            // We store the converted total at time of purchase for history reference
            convertedTotal: await convertCurrency(finalTotal, currency),
            orderDate: new Date(),
            status: 'Processing',
            isNew: true 
        };

        if (req.session.user) {
            order.userId = req.session.user.userId;
        }

        const result = await ordersCollection.insertOne(order);
        order._id = result.insertedId;

        // --- Mark Voucher as Used (if applicable) ---
        if (req.session.user && cart.voucher && cart.voucher._id) {
            await usersCollection.updateOne(
                { userId: req.session.user.userId, "vouchers.voucherId": new ObjectId(cart.voucher._id) },
                { $set: { "vouchers.$.isUsed": true } }
            );
        }

        // Stock Updates
        const stockUpdates = cart.items.map(item => {
            const safeSizeKey = item.size.replace('.', '_');
            const updateField = `stock.${safeSizeKey}`;
            return productsCollection.updateOne(
                { _id: new ObjectId(item.productId) },
                { $inc: { [updateField]: -item.qty } } 
            );
        });
        await Promise.all(stockUpdates);

        // Generate Email HTML
        const itemsWithConvertedPrice = await Promise.all(order.items.map(async item => {
            const convertedPrice = await convertCurrency(item.price, currency);
            return { ...item, convertedPrice };
        }));

        const itemsHtml = itemsWithConvertedPrice.map(item => `
            <tr>
                <td style="padding: 15px; vertical-align: top; background-color: #f5f5f7; border-radius: 8px 0 0 8px;">
                    <img src="${item.thumbnailUrl}" alt="${item.name}" width="60" style="border-radius: 8px;">
                </td>
                <td style="padding: 15px; vertical-align: top;">
                    <p style="margin: 0; font-weight: 600; max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</p>
                    <p style="margin: 0; font-size: 0.9em; color: #6e6e73;">Size: ${item.size}</p>
                </td>
                <td style="padding: 15px; vertical-align: top; text-align: center;">${item.qty}</td>
                <td style="padding: 15px; vertical-align: top; text-align: right; font-weight: 600;">${item.convertedPrice.toLocaleString(undefined, { style: 'currency', currency: currency })}</td>
            </tr>
        `).join('');

        const confirmationEmailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f7; color: #1d1d1f; }
                    .container { max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 40px; }
                    .header { text-align: center; border-bottom: 1px solid #d2d2d7; padding-bottom: 20px; margin-bottom: 20px;}
                    .header h1 { font-size: 24px; }
                    .items-table { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 20px; }
                    .summary-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    .summary-table td { padding: 8px 0; border-bottom: 1px solid #d2d2d7; }
                    .summary-table .total td { font-weight: 600; font-size: 1.2em; padding-top: 15px; border-bottom: none; }
                    .info-grid { display: table; width: 100%; margin-top: 30px; border-collapse: separate; border-spacing: 20px 0;}
                    .info-column { display: table-cell; width: 50%; vertical-align: top; }
                    .info-column h3 { font-size: 1em; margin-bottom: 10px;}
                    .footer { text-align: center; margin-top: 30px; font-size: 0.8em; color: #86868b; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Thank you for your order.</h1>
                        <p>Your order #${order._id.toString().slice(-7).toUpperCase()} is confirmed and will be shipping soon.</p>
                    </div>

                    <table class="items-table">
                        ${itemsHtml}
                    </table>

                    <table class="summary-table">
                        <tbody>
                            <tr>
                                <td>Subtotal</td>
                                <td style="text-align: right;">${order.subtotal.toLocaleString(undefined, { style: 'currency', currency: currency })}</td>
                            </tr>
                             ${discountAmount > 0 ? `
                            <tr>
                                <td>Discount</td>
                                <td style="text-align: right; color: #28a745;">-${discountAmount.toLocaleString(undefined, { style: 'currency', currency: currency })}</td>
                            </tr>` : ''}
                            <tr>
                                <td>Shipping</td>
                                <td style="text-align: right;">${order.shippingCost > 0 ? order.shippingCost.toLocaleString(undefined, { style: 'currency', currency: currency }) : 'Free'}</td>
                            </tr>
                            <tr class="total">
                                <td>Total</td>
                                <td style="text-align: right;">${order.convertedTotal.toLocaleString(undefined, { style: 'currency', currency: currency })}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="info-grid">
                        <div class="info-column">
                            <h3>Shipping to</h3>
                            <p style="color: #6e6e73; margin:0;">${order.customer.firstName} ${order.customer.lastName}<br>${order.shippingAddress.address}<br>${order.shippingAddress.state}, ${order.shippingAddress.zip}</p>
                        </div>
                        <div class="info-column">
                            <h3>Payment</h3>
                            <p style="color: #6e6e73; margin:0;">${order.paymentDetails.method} ${order.paymentDetails.last4 ? `ending in ${order.paymentDetails.last4}` : ''}</p>
                        </div>
                    </div>

                    <div class="footer">
                        <p>Need help? <a href="#">Contact our support team.</a></p>
                        <p>&copy; ${new Date().getFullYear()} Sneakslab. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: order.customer.email,
            subject: `Your sneakslab Order Confirmation #${order._id.toString().slice(-7)}`,
            html: confirmationEmailHtml,
        });

        req.session.cart = null;

        res.redirect(`/checkout/success/${result.insertedId}`);

    } catch (err) {
        console.error("Error placing order:", err);
        res.status(500).send("An error occurred while placing your order.");
    }
});

// GET /checkout/success/:orderId - Display the order confirmation page with Currency Conversion
router.get('/success/:orderId', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const orderId = req.params.orderId;
        const currency = res.locals.locationData.currency;

        const order = await ordersCollection.findOne({ _id: new ObjectId(orderId) });

        if (!order) {
            return res.status(404).send("Order not found.");
        }

        // Convert monetary values for the view
        if (typeof convertCurrency === 'function') {
            order.subtotal = await convertCurrency(order.subtotal, currency);
            order.shippingCost = await convertCurrency(order.shippingCost, currency);
            order.total = await convertCurrency(order.total, currency);
            if (order.discount) {
                 order.discount = await convertCurrency(order.discount, currency);
            }

            // Convert item prices
            order.items = await Promise.all(order.items.map(async (item) => {
                // Note: 'price' usually stores line total (unit * qty) in original currency
                item.price = await convertCurrency(item.price, currency);
                return item;
            }));
        }

        res.render('order-success', {
            title: "Order Confirmation",
            order: order,
            pageStyle: 'order-success'
        });

    } catch (err) {
        console.error("Error fetching order confirmation:", err);
        res.status(500).send("An error occurred while retrieving order confirmation.");
    }
});

module.exports = router;