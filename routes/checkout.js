// routes/checkout.js

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { Resend } = require('resend');
const { convertCurrency } = require('./currency');
const QRCode = require('qrcode'); // Required for NFC/QR Payment

const resend = new Resend(process.env.RESEND_API_KEY);

// Define shipping constants (using USD as the base currency)
const SHIPPING_COST_BASE = 5; // e.g., $5 shipping
const FREE_SHIPPING_THRESHOLD_BASE = 150; // e.g., free shipping on orders over $150

// --- STORE LOCATIONS DATA ---
const STORES = [
    { id: 1, name: "Sneakslab Podium", address: "2/F The Podium, 12 ADB Ave, Mandaluyong", city: "Metro Manila" },
    { id: 2, name: "Sneakslab The Fort", address: "B3 Bonifacio High St, BGC, Taguig", city: "Metro Manila" },
    { id: 3, name: "Sneakslab Greenbelt", address: "Level 3, Greenbelt 5, Makati", city: "Metro Manila" },
    { id: 4, name: "Sneakslab SM Baguio", address: "UGF, SM City Baguio, Luneta Hill", city: "Baguio" },
    { id: 5, name: "Sneakslab Session", address: "104 Session Road, Baguio City", city: "Baguio" },
    { id: 6, name: "Sneakslab Camp John Hay", address: "Technohub, Camp John Hay, Baguio", city: "Baguio" },
    { id: 7, name: "Sneakslab Ayala Cebu", address: "Level 1, Ayala Center Cebu", city: "Cebu" },
    { id: 8, name: "Sneakslab SM Seaside", address: "2nd Level, SM Seaside City Cebu", city: "Cebu" },
    { id: 9, name: "Sneakslab IT Park", address: "Central Bloc, Cebu IT Park", city: "Cebu" },
    { id: 10, name: "Sneakslab SM Lanang", address: "2nd Floor, SM Lanang Premier", city: "Davao" },
    { id: 11, name: "Sneakslab Abreeza", address: "G/F Abreeza Mall, J.P. Laurel Ave", city: "Davao" },
    { id: 12, name: "Sneakslab G-Mall", address: "3rd Level, Gaisano Mall of Davao", city: "Davao" }
];

// Helper function for date formatting
const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ==========================================
// ============ CHECKOUT ROUTES =============
// ==========================================

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

    // --- NFC / QR PAYMENT SETUP ---
    const nfcTransactionId = new ObjectId().toString();
    const baseUrl = process.env.BASE_URL_LIVE || `http://${req.headers.host}`;
    const nfcPayUrl = `${baseUrl}/checkout/nfc-pay/${nfcTransactionId}`;
    const nfcQrCode = await QRCode.toDataURL(nfcPayUrl);
    // ------------------------------

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
        appliedVoucher: cart.voucher,
        stores: STORES,
        nfcTransactionId, // Pass to view for socket listener
        nfcQrCode // Pass QR Image Data URL
    });
});

// ==========================================
// ============ NFC & GATEWAY ROUTES ========
// ==========================================

// --- NFC Payer Screen (Mobile View) ---
router.get('/nfc-pay/:id', (req, res) => {
    // This page simulates the screen seen by the user tapping their phone
    res.render('nfc-payer', { transactionId: req.params.id, title: "Sneakslab Pay" });
});

// --- NFC Trigger (Called by Payer Screen) ---
router.post('/nfc-trigger', (req, res) => {
    const { transactionId } = req.body;
    const io = req.app.get('io');
    
    if(io) {
        // Emit success event to the checkout page listening on this transaction ID
        io.emit(`nfc-payment-success:${transactionId}`, { 
            success: true, 
            token: `NFC-${Date.now()}-${Math.floor(Math.random() * 1000)}` 
        });
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false, message: "Socket not initialized" });
    }
});


// --- Mock Payment Gateway Page ---
router.get('/gateway/:provider/:orderId', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.orderId) });
        if(!order) return res.status(404).send("Order not found");

        let theme = { bg: '#f5f5f7', icon: 'bi-wallet2', text: '#fff', headerBg: '#333', headerText: '#fff', btnBg: '#333', btnText: '#fff' };
        let providerName = 'Payment Gateway';
        
        if (req.params.provider === 'gcash') {
            theme = { bg: '#0057e7', headerBg: '#0057e7', headerText: '#fff', icon: 'bi-wallet-fill', btnBg: '#fff', btnText: '#0057e7' };
            providerName = 'GCash';
        } else if (req.params.provider === 'grabpay') {
            theme = { bg: '#00b14f', headerBg: '#00b14f', headerText: '#fff', icon: 'bi-phone', btnBg: '#fff', btnText: '#00b14f' };
            providerName = 'GrabPay';
        } else if (req.params.provider === 'paypal') {
            theme = { bg: '#003087', headerBg: '#fff', headerText: '#003087', icon: 'bi-paypal', btnBg: '#003087', btnText: '#fff' };
            providerName = 'PayPal';
        }

        res.render('payment-gateway', {
            title: `Pay with ${providerName}`, // <--- ADDED THIS LINE
            orderId: req.params.orderId,
            amount: order.convertedTotal,
            currency: order.currency,
            providerName,
            theme
        });
    } catch(e) { 
        console.error(e);
        res.status(500).send("Error loading gateway"); 
    }
});

// --- Confirm Payment (Callback from Gateway) ---
router.post('/confirm-payment/:orderId', async (req, res) => {
    const db = req.app.locals.client.db(req.app.locals.dbName);
    const orderId = req.params.orderId;
    
    // 1. Update Order Status
    await db.collection('orders').updateOne(
        { _id: new ObjectId(orderId) }, 
        { $set: { status: 'Processing' } }
    );
    
    // 2. Get Updated Order & Session Data
    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    const cart = req.session.cart; // Cart still exists in session until confirmed

    // 3. Deduct Stock (Late Deduction for Async Payments)
    if (cart && cart.items) {
        const productsCollection = db.collection('products');
        const updates = cart.items.map(item => productsCollection.updateOne(
            { _id: new ObjectId(item.productId) }, 
            { $inc: { [`stock.${item.size.replace('.', '_')}`]: -item.qty } }
        ));
        await Promise.all(updates);
    }

    // 4. Update Admin Dashboard
    const io = req.app.get('io');
    if (io) {
        io.emit('dashboardUpdate', { 
            type: 'new_order', 
            message: `New Order #${orderId.slice(-4)}`, 
            orderTotal: order.total 
        });
    }

    // 5. Send Email
    // (Re-using email logic would be ideal here, but for brevity we rely on the main place-order logic or send a simple success email here)
    if (order && order.customer && order.customer.email) {
         await resend.emails.send({ 
             from: process.env.RESEND_FROM_EMAIL, 
             to: order.customer.email, 
             subject: 'Payment Confirmed', 
             html: `<h1>Payment Received</h1><p>Your order #${orderId.slice(-7)} is now processing.</p>` 
        });
    }

    // 6. Clear Session
    req.session.cart = null;
    if(req.session.voucher) delete req.session.voucher;

    res.redirect(`/checkout/success/${orderId}`);
});

// ==========================================
// ============ ACTION ROUTES ===============
// ==========================================

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
        let finalShippingCost;

        const { selectedAddressId, saveAddress, sameAsShipping, 'delivery-method': deliveryMethod } = req.body;
        const paymentMethod = req.body['payment-method'];

        // --- HANDLE DELIVERY METHOD (Shipping vs Pickup) ---
        if (deliveryMethod === 'pickup') {
            // Store Pickup Logic
            const storeId = parseInt(req.body.pickupStore);
            const store = STORES.find(s => s.id === storeId);
            
            if (!store) throw new Error("Invalid store selected");

            shippingAddress = {
                firstName: req.body.pickupFirstName,
                lastName: req.body.pickupLastName,
                address: `STORE PICKUP: ${store.name} (${store.address})`, // Save full pickup location
                country: 'Philippines',
                state: store.city,
                zip: 'N/A',
                phone: req.body.pickupPhone,
                isPickup: true
            };
            
            finalShippingCost = 0; // Free shipping for pickup

        } else {
            // Standard Shipping Logic
            if (req.session.user && selectedAddressId && selectedAddressId !== 'new') {
                const user = await usersCollection.findOne({ userId: req.session.user.userId });
                const savedAddress = user.addresses.find(addr => addr.addressId === selectedAddressId);
                if (savedAddress) {
                    shippingAddress = savedAddress;
                }
            }
            
            // Fallback to manual entry if no saved address selected or guest
            if (!shippingAddress) {
                shippingAddress = {
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    address: req.body.address,
                    country: req.body.country,
                    state: req.body.state,
                    zip: req.body.zip,
                    phone: req.body.phone
                };
                
                // Only save address to profile if it's standard shipping and user requested it
                if (req.session.user && saveAddress === 'on') {
                    const newAddressForProfile = { ...shippingAddress, addressId: uuidv4(), isDefault: false };
                    await usersCollection.updateOne(
                        { userId: req.session.user.userId },
                        { $push: { addresses: newAddressForProfile } }
                    );
                }
            }

            // Calculate Shipping Cost for Standard Delivery
            const now = new Date();
            const activeSale = await db.collection('sales').findOne({
                startDate: { $lte: now },
                endDate: { $gte: now }
            });
            finalShippingCost = (activeSale || cart.totalPrice >= FREE_SHIPPING_THRESHOLD_BASE) ? 0 : SHIPPING_COST_BASE;
        }

        // --- HANDLE BILLING ADDRESS ---
        if (sameAsShipping === 'on' || deliveryMethod === 'pickup') {
            billingAddress = { ...shippingAddress };
        } else {
            billingAddress = {
                address: req.body['billing-address'],
                country: req.body['billing-country'],
                state: req.body['billing-state'],
                zip: req.body['billing-zip']
            };
        }

        // --- HANDLE PAYMENT METHOD (Enhanced) ---
        let paymentDetails = { method: 'Unknown' };
        
        if (paymentMethod === 'cc') {
            const ccNumber = req.body['cc-number'] || '';
            paymentDetails.method = 'Credit Card';
            paymentDetails.last4 = ccNumber.slice(-4);
        } else if (paymentMethod === 'financing') {
            paymentDetails.method = 'Financing';
            const plan = req.body['financing-plan'];
            paymentDetails.plan = plan === 'pay-in-4' ? 'Pay in 4' : 'Monthly Installments';
        } else if (paymentMethod === 'nfc') {
            paymentDetails.method = 'NFC Tap to Pay';
            paymentDetails.token = req.body['nfc-token']; // Token from hidden input populated by socket
        } else if (['gcash', 'grabpay', 'paypal'].includes(paymentMethod)) {
            paymentDetails.method = paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1);
        } else {
            paymentDetails.method = deliveryMethod === 'pickup' ? 'Pay in Store' : 'Cash on Delivery';
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

        const finalTotal = subtotal - discountAmount + finalShippingCost;

        // Determine Status based on Payment
        const orderStatus = ['gcash', 'grabpay', 'paypal'].includes(paymentMethod) ? 'Pending Payment' : 'Processing';

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
            discount: discountAmount,
            voucherCode: cart.voucher ? cart.voucher.code : null,
            shippingCost: finalShippingCost,
            total: finalTotal,
            currency: currency,
            convertedTotal: await convertCurrency(finalTotal, currency),
            orderDate: new Date(),
            status: orderStatus,
            isNew: true,
            deliveryMethod: deliveryMethod || 'shipping'
        };

        if (req.session.user) {
            order.userId = req.session.user.userId;
        }

        const result = await ordersCollection.insertOne(order);
        order._id = result.insertedId;

        // --- HANDLE REDIRECTS FOR EXTERNAL GATEWAYS ---
        if (['gcash', 'grabpay', 'paypal'].includes(paymentMethod)) {
            // Note: We don't clear cart yet for async payments, wait for callback
            return res.redirect(`/checkout/gateway/${paymentMethod}/${result.insertedId}`);
        }

        // --- POST-ORDER PROCESSING (Immediate Confirmation) ---

        // Mark Voucher as Used
        if (req.session.user && cart.voucher && cart.voucher._id) {
            await usersCollection.updateOne(
                { userId: req.session.user.userId, "vouchers.voucherId": new ObjectId(cart.voucher._id) },
                { $set: { "vouchers.$.isUsed": true } }
            );
        }

        // Stock Updates (Immediate)
        const stockUpdates = cart.items.map(item => {
            const safeSizeKey = item.size.replace('.', '_');
            return productsCollection.updateOne(
                { _id: new ObjectId(item.productId) },
                { $inc: { [`stock.${safeSizeKey}`]: -item.qty } } 
            );
        });
        await Promise.all(stockUpdates);

        // Emit Real-Time Update to Admin
        const io = req.app.get('io');
        if (io) {
            io.emit('dashboardUpdate', { 
                type: 'new_order', 
                message: `New Order #${order._id.toString().slice(-4).toUpperCase()}`,
                orderTotal: order.total
            });
        }

        // Generate Email
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
                        <p>Your order #${order._id.toString().slice(-7).toUpperCase()} is confirmed and will be ready soon.</p>
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
                            <h3>${order.deliveryMethod === 'pickup' ? 'Pickup Location' : 'Shipping to'}</h3>
                            <p style="color: #6e6e73; margin:0;">${order.customer.firstName} ${order.customer.lastName}<br>${order.shippingAddress.address}<br>${order.shippingAddress.state}, ${order.shippingAddress.zip}</p>
                        </div>
                        <div class="info-column">
                            <h3>Payment</h3>
                            <p style="color: #6e6e73; margin:0;">${order.paymentDetails.method} ${order.paymentDetails.last4 ? `ending in ${order.paymentDetails.last4}` : ''}</p>
                            ${order.paymentDetails.plan ? `<p style="color: #6e6e73; margin:0;">Plan: ${order.paymentDetails.plan}</p>` : ''}
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

        // Clear Session
        req.session.cart = null;
        if(req.session.voucher) delete req.session.voucher;

        res.redirect(`/checkout/success/${result.insertedId}`);

    } catch (err) {
        console.error("Error placing order:", err);
        res.status(500).send("An error occurred while placing your order.");
    }
});

// GET /checkout/success/:orderId
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