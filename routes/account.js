// routes/account.js

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { Resend } = require('resend');
const bcrypt = require('bcrypt');
const saltRounds = 12;
const { convertCurrency } = require('./currency');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs'); // Required for Excel exports

const resend = new Resend(process.env.RESEND_API_KEY);

// --- Multer Setup for Image Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = 'public/uploads/avatars';
        if (!fs.existsSync(uploadPath)){
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, req.session.user.userId + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
});

// --- Helper Functions ---

const createStatusEmailHtml = (order) => {
    const itemsHtml = order.items.map(item => `
        <tr>
            <td style="padding: 15px; vertical-align: top; background-color: #f5f5f7; border-radius: 8px 0 0 8px;">
                <img src="${item.thumbnailUrl}" alt="${item.name}" width="60" style="border-radius: 8px;">
            </td>
            <td style="padding: 15px; vertical-align: top;">
                <p style="margin: 0; font-weight: 600; max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</p>
                <p style="margin: 0; font-size: 0.9em; color: #6e6e73;">Size: ${item.size}</p>
            </td>
            <td style="padding: 15px; vertical-align: top; text-align: center;">${item.qty}</td>
            <td style="padding: 15px; vertical-align: top; text-align: right; font-weight: 600;">${order.total.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</td>
        </tr>
    `).join('');

    let headerMessage = 'Your order has been updated.';
    let subMessage = `Order #${order._id.toString().slice(-7).toUpperCase()}`;

    if (order.status === 'Processing') {
        headerMessage = 'Thank you for your order.';
        subMessage = `Your order #${order._id.toString().slice(-7).toUpperCase()} is confirmed and will be shipping soon.`;
    } else if (order.status === 'Shipped') {
        headerMessage = 'Good news! Your order has shipped.';
    } else if (order.status === 'Delivered') {
        headerMessage = 'Your order has been delivered.';
    } else if (order.status === 'Cancelled') {
        headerMessage = 'Your order has been cancelled.';
        subMessage = `Your order #${order._id.toString().slice(-7).toUpperCase()} has been successfully cancelled.`;
    }

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f7; color: #1d1d1f; } .container { max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 40px; } .header { text-align: center; border-bottom: 1px solid #d2d2d7; padding-bottom: 20px; margin-bottom: 20px;} .header h1 { font-size: 24px; } .items-table { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 20px; } .info-grid { display: table; width: 100%; margin-top: 30px; border-collapse: separate; border-spacing: 20px 0;} .info-column { display: table-cell; width: 50%; vertical-align: top; } .info-column h3 { font-size: 1em; margin-bottom: 10px;} .footer { text-align: center; margin-top: 30px; font-size: 0.8em; color: #86868b; }</style>
        </head>
        <body>
            <div class="container">
                <div class="header"><h1>${headerMessage}</h1><p>${subMessage}</p></div>
                <table class="items-table">${itemsHtml}</table>
                <div class="info-grid">
                    <div class="info-column"><h3>Shipping to</h3><p style="color: #6e6e73; margin:0;">${order.customer.firstName} ${order.customer.lastName}<br>${order.shippingAddress.address}<br>${order.shippingAddress.state}, ${order.shippingAddress.zip}</p></div>
                    <div class="info-column"><h3>Payment</h3><p style="color: #6e6e73; margin:0;">${order.paymentDetails.method} ${order.paymentDetails.last4 ? `ending in ${order.paymentDetails.last4}` : ''}</p></div>
                </div>
                <div class="footer"><p>Need help? <a href="#">Contact our support team.</a></p><p>&copy; ${new Date().getFullYear()} Sneakslab. All rights reserved.</p></div>
            </div>
        </body>
        </html>
    `;
};

const parseDevice = (uaString) => {
    if (!uaString) return { name: 'Unknown Device', icon: 'bi-question-circle' };
    let name = 'Web Browser';
    let icon = 'bi-laptop';
    if (/windows/i.test(uaString)) name += ' on Windows';
    else if (/macintosh|mac os x/i.test(uaString)) name += ' on macOS';
    else if (/linux/i.test(uaString)) name += ' on Linux';
    else if (/android/i.test(uaString)) { name = 'Android Device'; icon = 'bi-phone'; }
    else if (/iphone|ipad|ipod/i.test(uaString)) { name = 'iOS Device'; icon = 'bi-phone'; }
    if (/chrome/i.test(uaString) && !/edg/i.test(uaString)) name = name.replace('Web Browser', 'Chrome');
    else if (/safari/i.test(uaString) && !/chrome/i.test(uaString)) name = name.replace('Web Browser', 'Safari');
    else if (/firefox/i.test(uaString)) name = name.replace('Web Browser', 'Firefox');
    else if (/edg/i.test(uaString)) name = name.replace('Web Browser', 'Edge');
    return { name, icon };
};

// --- Middleware ---
const isLoggedIn = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/users/login');
    }
    res.locals.user = req.session.user;
    res.locals.currentUser = req.session.user;
    next();
};

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send("Access Denied: You do not have permission to view this page.");
};

router.use(isLoggedIn);

// --- Main Route Redirect ---
router.get('/', (req, res) => {
    if (req.session.user.role === 'admin') {
        res.redirect('/account/admin/dashboard');
    } else {
        res.redirect('/account/settings');
    }
});

// ==========================================
// =========== USER ROUTES ==================
// ==========================================

// UPDATED: Fetch user data from DB to ensure bio is fresh
router.get('/settings', async (req, res) => { 
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const user = await db.collection('users').findOne({ userId: req.session.user.userId });
        
        res.render('account/settings', { 
            title: "Settings", 
            view: 'settings',
            user: user, // Pass the full user object (with bio) from DB
            message: req.query.message, 
            error: req.query.error 
        }); 
    } catch (err) {
        console.error("Error loading settings:", err);
        res.status(500).send("Error loading settings.");
    }
});

router.get('/identity', async (req, res) => {
    const db = req.app.locals.client.db(req.app.locals.dbName);
    const user = await db.collection('users').findOne({ userId: req.session.user.userId });
    res.render('account/settings-identity', { 
        title: "Identity", 
        view: 'settings', 
        user: user, 
        message: req.query.message, 
        error: req.query.error 
    });
});

router.get('/security', async (req, res) => {
    const db = req.app.locals.client.db(req.app.locals.dbName);
    const user = await db.collection('users').findOne({ userId: req.session.user.userId });
    const loginHistory = (user && user.loginHistory) ? user.loginHistory.map(entry => {
        const details = parseDevice(entry.userAgent);
        return { ...entry, displayName: details.name, icon: details.icon };
    }) : [];
    res.render('account/settings-security', { 
        title: "Security", 
        view: 'settings', 
        message: req.query.message, 
        error: req.query.error, 
        loginHistory: loginHistory 
    });
});

router.get('/addresses', async (req, res) => {
    const db = req.app.locals.client.db(req.app.locals.dbName);
    const user = await db.collection('users').findOne({ userId: req.session.user.userId });
    res.render('account/settings-addresses', { 
        title: "Addresses", 
        view: 'settings', 
        user: user, 
        message: req.query.message, 
        error: req.query.error 
    });
});

// --- USER VOUCHERS ---
router.get('/vouchers', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const user = await db.collection('users').findOne({ userId: req.session.user.userId });
        let userVouchers = [];
        if (user.vouchers && user.vouchers.length > 0) {
            const voucherIds = user.vouchers.map(v => v.voucherId);
            const voucherDetails = await db.collection('vouchers').find({ _id: { $in: voucherIds } }).toArray();
            userVouchers = user.vouchers.map(uv => {
                const detail = voucherDetails.find(d => d._id.equals(uv.voucherId));
                return detail ? { ...uv, details: detail } : null;
            }).filter(v => v !== null);
        }
        res.render('account/settings-vouchers', { 
            title: "My Vouchers", 
            view: 'settings', 
            userVouchers: userVouchers, 
            message: req.query.message, 
            error: req.query.error 
        });
    } catch (err) { 
        res.status(500).send("Error loading vouchers."); 
    }
});

router.post('/vouchers/redeem', async (req, res) => {
    try {
        const { code } = req.body;
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const voucher = await db.collection('vouchers').findOne({ code: code.toUpperCase(), isActive: true });
        if (!voucher || new Date(voucher.expiryDate) < new Date()) return res.redirect('/account/vouchers?error=' + encodeURIComponent('Invalid or expired code.'));
        const user = await db.collection('users').findOne({ userId: req.session.user.userId });
        if (user.vouchers && user.vouchers.some(v => v.voucherId.equals(voucher._id))) return res.redirect('/account/vouchers?error=' + encodeURIComponent('Already redeemed.'));
        
        await db.collection('users').updateOne({ userId: req.session.user.userId }, { $push: { vouchers: { voucherId: voucher._id, isUsed: false, redeemedAt: new Date() } } });
        res.redirect('/account/vouchers?message=' + encodeURIComponent('Voucher redeemed!'));
    } catch (err) { 
        res.redirect('/account/vouchers?error=' + encodeURIComponent('Error.')); 
    }
});

// --- USER SHOPPING ROUTES ---
router.post('/wishlist/toggle', async (req, res) => {
    try {
        const { productId } = req.body;
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const productObjectId = new ObjectId(productId);
        const user = await db.collection('users').findOne({ userId: req.session.user.userId });
        const isWishlisted = user && user.wishlist && user.wishlist.some(id => id.equals(productObjectId));
        
        if (isWishlisted) { 
            await db.collection('users').updateOne({ userId: req.session.user.userId }, { $pull: { wishlist: productObjectId } }); 
        } else { 
            await db.collection('users').updateOne({ userId: req.session.user.userId }, { $addToSet: { wishlist: productObjectId } }); 
        }
        
        res.json({ success: true, newStatus: isWishlisted ? 'removed' : 'added' });
    } catch (err) { 
        res.status(500).json({ success: false }); 
    }
});

router.get('/wishlist', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const user = await db.collection('users').findOne({ userId: req.session.user.userId });
        let products = [];
        if (user && user.wishlist && user.wishlist.length > 0) {
            products = await db.collection('products').find({ _id: { $in: user.wishlist } }).toArray();
        }
        res.render('account/wishlist', { 
            title: "My Wishlist", 
            view: 'wishlist', 
            products: products, 
            wishlist: user.wishlist || [] 
        });
    } catch (err) { 
        res.status(500).send("Error loading wishlist."); 
    }
});

router.get('/orders', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const userOrders = await db.collection('orders').find({ userId: req.session.user.userId }).sort({ orderDate: -1 }).toArray();
        
        const currency = res.locals.locationData.currency;
        const convertedOrders = await Promise.all(userOrders.map(async (o) => {
             o.total = await convertCurrency(o.total, currency);
             return o;
        }));

        res.render('account/order-history', { 
            title: "Order History", 
            orders: convertedOrders, 
            view: 'orders', 
            pageStyle: 'order-success' 
        });
    } catch (err) { 
        res.status(500).send("Error loading orders."); 
    }
});

router.get('/orders/:id', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id), userId: req.session.user.userId });
        
        if (!order) return res.status(404).send("Order not found.");
        
        const currency = res.locals.locationData.currency;
        if (typeof convertCurrency === 'function') {
             order.total = await convertCurrency(order.total, currency);
             order.subtotal = await convertCurrency(order.subtotal, currency);
             order.shippingCost = await convertCurrency(order.shippingCost, currency);
             if(order.discount) order.discount = await convertCurrency(order.discount, currency);

             order.items = await Promise.all(order.items.map(async (item) => {
                item.price = await convertCurrency(item.price, currency);
                return item;
             }));
        }

        res.render('support/order-status', { 
            title: `Order #${order._id.toString().slice(-7).toUpperCase()}`, 
            order: order, 
            error: null, 
            pageStyle: 'order-success' 
        });
    } catch (err) { 
        res.status(500).send("Error loading details."); 
    }
});

// NEW: My Financing / Loans Route
router.get('/loans', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const currency = res.locals.locationData.currency;
        
        // Fetch orders paid via Financing
        const loanOrders = await db.collection('orders').find({
            userId: req.session.user.userId,
            'paymentDetails.method': 'Financing'
        }).sort({ orderDate: -1 }).toArray();

        // Process loans (Mocking payment progress for demo purposes)
        const loans = await Promise.all(loanOrders.map(async (order) => {
            // Convert total
            const convertedTotal = await convertCurrency(order.total, currency);
            
            // Mock Logic: Determine progress based on order date
            const daysSinceOrder = Math.floor((new Date() - new Date(order.orderDate)) / (1000 * 60 * 60 * 24));
            let paymentsMade = 1; // Initial payment
            let totalPayments = order.paymentDetails.plan === 'Pay in 4' ? 4 : 6; // 4 for PayIn4, 6 for Monthly
            
            // Simulate payments every 14 days
            paymentsMade += Math.floor(daysSinceOrder / 14);
            if (paymentsMade > totalPayments) paymentsMade = totalPayments;

            const progress = (paymentsMade / totalPayments) * 100;
            const remainingBalance = order.total * (1 - (paymentsMade / totalPayments));
            const convertedRemaining = await convertCurrency(remainingBalance, currency);
            const nextPaymentDate = new Date(order.orderDate);
            nextPaymentDate.setDate(nextPaymentDate.getDate() + (paymentsMade * 14));

            return {
                orderId: order._id,
                plan: order.paymentDetails.plan || 'Pay in 4',
                total: convertedTotal,
                remaining: convertedRemaining,
                progress: progress,
                paymentsMade: paymentsMade,
                totalPayments: totalPayments,
                nextPayment: paymentsMade < totalPayments ? nextPaymentDate : null,
                status: paymentsMade >= totalPayments ? 'Paid Off' : 'Active',
                items: order.items.slice(0, 3) // Show first 3 items preview
            };
        }));

        res.render('account/loans', { 
            title: "My Financing", 
            view: 'loans', 
            loans: loans 
        });
    } catch (err) { 
        console.error("Error loading loans:", err);
        res.status(500).send("Error loading financing data."); 
    }
});

// --- USER FORM ACTIONS ---
router.post('/settings/update-profile', upload.single('profilePhoto'), async (req, res) => {
    try {
        const { firstName, lastName, phone, bio } = req.body;
        let updateFields = { firstName, lastName, phone: phone || "", bio: bio || "", updatedAt: new Date() };
        if (req.file) updateFields.profilePictureUrl = '/uploads/avatars/' + req.file.filename;
        
        await req.app.locals.client.db(req.app.locals.dbName).collection('users').updateOne({ userId: req.session.user.userId }, { $set: updateFields });
        
        // Update session
        req.session.user.firstName = firstName;
        req.session.user.lastName = lastName;
        req.session.user.bio = bio; // UPDATED: Ensure bio is updated in session
        if (req.file) req.session.user.profilePictureUrl = updateFields.profilePictureUrl;
        
        res.redirect('/account/identity?message=' + encodeURIComponent('Profile updated!'));
    } catch (err) { 
        res.redirect('/account/identity?error=' + encodeURIComponent('Update failed.')); 
    }
});

router.post('/settings/update-password', async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        if (newPassword !== confirmPassword) return res.redirect('/account/security?error=' + encodeURIComponent('Passwords mismatch.'));
        
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const user = await db.collection('users').findOne({ userId: req.session.user.userId });
        if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return res.redirect('/account/security?error=' + encodeURIComponent('Incorrect password.'));
        
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        await db.collection('users').updateOne({ userId: req.session.user.userId }, { $set: { passwordHash: hashedPassword, updatedAt: new Date() } });
        res.redirect('/account/security?message=' + encodeURIComponent('Password changed.'));
    } catch (err) { 
        res.redirect('/account/security?error=' + encodeURIComponent('Update failed.')); 
    }
});

router.post('/settings/add-address', async (req, res) => {
    try {
        const { v4: uuidv4 } = await import('uuid');
        const newAddr = { 
            addressId: uuidv4(), firstName: req.body.firstName, lastName: req.body.lastName, 
            address: req.body.address, country: req.body.country, state: req.body.state, 
            zip: req.body.zip, phone: req.body.phone, isDefault: req.body.isDefault === 'on' 
        };
        const db = req.app.locals.client.db(req.app.locals.dbName);
        if (newAddr.isDefault) await db.collection('users').updateOne({ userId: req.session.user.userId }, { $set: { "addresses.$[].isDefault": false } });
        await db.collection('users').updateOne({ userId: req.session.user.userId }, { $push: { addresses: newAddr } });
        res.redirect('/account/addresses?message=' + encodeURIComponent('Address added successfully!'));
    } catch (err) { 
        res.redirect('/account/addresses?error=' + encodeURIComponent('Failed to add.')); 
    }
});

router.post('/settings/edit-address/:addressId', async (req, res) => {
    try {
        const updAddr = { 
            addressId: req.params.addressId, firstName: req.body.firstName, lastName: req.body.lastName, 
            address: req.body.address, country: req.body.country, state: req.body.state, 
            zip: req.body.zip, phone: req.body.phone, isDefault: req.body.isDefault === 'on' 
        };
        const db = req.app.locals.client.db(req.app.locals.dbName);
        if (updAddr.isDefault) await db.collection('users').updateOne({ userId: req.session.user.userId }, { $set: { "addresses.$[].isDefault": false } });
        await db.collection('users').updateOne({ userId: req.session.user.userId, "addresses.addressId": req.params.addressId }, { $set: { "addresses.$": updAddr } });
        res.redirect('/account/addresses?message=' + encodeURIComponent('Address updated successfully!'));
    } catch (err) { 
        res.redirect('/account/addresses?error=' + encodeURIComponent('Failed to update.')); 
    }
});

router.post('/settings/delete-address/:addressId', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        await db.collection('users').updateOne({ userId: req.session.user.userId }, { $pull: { addresses: { addressId: req.params.addressId } } });
        res.redirect('/account/addresses?message=' + encodeURIComponent('Address removed successfully!'));
    } catch (err) { 
        res.redirect('/account/addresses?error=' + encodeURIComponent('Failed to delete.')); 
    }
});

// ==========================================
// =========== ADMIN ROUTES =================
// ==========================================

// Helper to build filter query for Dashboard & Reports
const buildDashboardQuery = (dateRange, status) => {
    let matchQuery = {};
    if (dateRange) {
        const dates = dateRange.split(' to ');
        let startDate, endDate;
        if (dates.length >= 1) startDate = new Date(dates[0]);
        if (dates.length === 2) endDate = new Date(dates[1]);
        else if (startDate) endDate = new Date(startDate);

        if (startDate && endDate) {
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            matchQuery.orderDate = { $gte: startDate, $lte: endDate };
        }
    }
    if (status && status !== 'All') {
        matchQuery.status = status;
    }
    return matchQuery;
};

// 1. Dashboard (Enhanced with Analytics & Shared Query Logic)
router.get('/admin/dashboard', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const currency = res.locals.locationData.currency;
        const { dateRange, status } = req.query;
        
        // Use helper to build query
        const matchQuery = buildDashboardQuery(dateRange, status);

        // --- Parallel Aggregation ---
        const [
            userCount, 
            productCount, 
            filteredStats,
            dailySalesRaw,
            topProductsRaw,
            salesByBrandRaw,
            orderStatusRaw
        ] = await Promise.all([
            db.collection('users').countDocuments(),
            db.collection('products').countDocuments(),
            
            // 1. Total Revenue & Count (Filtered)
            db.collection('orders').aggregate([
                { $match: matchQuery },
                { $group: { _id: null, totalRevenue: { $sum: "$total" }, orderCount: { $sum: 1 } } }
            ]).toArray(),

            // 2. Daily Sales Trend (Filtered)
            db.collection('orders').aggregate([
                { $match: matchQuery },
                { 
                    $group: { 
                        _id: { $dateToString: { format: "%Y-%m-%d", date: "$orderDate" } },
                        revenue: { $sum: "$total" },
                        orders: { $sum: 1 }
                    } 
                },
                { $sort: { _id: 1 } }
            ]).toArray(),

            // 3. Top 5 Selling Products (Filtered)
            db.collection('orders').aggregate([
                { $match: matchQuery },
                { $unwind: "$items" },
                { $group: { 
                    _id: "$items.productId",
                    name: { $first: "$items.name" },
                    thumbnailUrl: { $first: "$items.thumbnailUrl" },
                    brand: { $first: "$items.brand" },
                    qty: { $sum: "$items.qty" },
                    revenue: { $sum: "$items.price" }
                }},
                { $sort: { qty: -1 } },
                { $limit: 5 }
            ]).toArray(),

            // 4. Sales by Brand (Filtered)
            db.collection('orders').aggregate([
                { $match: matchQuery },
                { $unwind: "$items" },
                { $group: { _id: "$items.brand", revenue: { $sum: "$items.price" } } },
                { $sort: { revenue: -1 } }
            ]).toArray(),

            // 5. Order Status Distribution (Filtered)
            db.collection('orders').aggregate([
                { $match: matchQuery },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ]).toArray()
        ]);
        
        // Recent Activity (Unfiltered Log + Orders)
        const recentActivity = await db.collection('orders').aggregate([
            { $sort: { orderDate: -1 } }, { $limit: 10 },
            { $project: { type: 'ORDER', timestamp: '$orderDate', data: '$$ROOT' } },
            { $unionWith: { 
                coll: 'activity_log', 
                pipeline: [{ $sort: { timestamp: -1 } }, { $limit: 10 }, { $project: { type: '$actionType', timestamp: '$timestamp', data: '$$ROOT' } }] 
            }},
            { $sort: { timestamp: -1 } }, { $limit: 10 }
        ]).toArray();

        // --- Data Formatting & Currency Conversion ---
        const stats = filteredStats[0] || { totalRevenue: 0, orderCount: 0 };
        const totalRevenue = await convertCurrency(Number(stats.totalRevenue), currency);
        
        // Daily Sales
        const dailySales = await Promise.all(dailySalesRaw.map(async d => ({
            date: d._id,
            orders: d.orders,
            revenue: await convertCurrency(Number(d.revenue), currency)
        })));

        // Top Products
        const topProducts = await Promise.all(topProductsRaw.map(async p => ({
            ...p,
            revenue: await convertCurrency(Number(p.revenue), currency)
        })));

        // Activity Log
        const convertedActivity = await Promise.all(recentActivity.map(async (act) => {
            if (act.type === 'ORDER') {
                act.data.total = await convertCurrency(Number(act.data.total), currency);
            } else if (act.type === 'PRICE_UPDATE') {
                act.data.details.oldPrice = await convertCurrency(Number(act.data.details.oldPrice), currency);
                act.data.details.newPrice = await convertCurrency(Number(act.data.details.newPrice), currency);
            }
            return act;
        }));

        res.render('account/dashboard', { 
            title: "Admin Dashboard", 
            view: 'admin-dashboard', 
            data: { 
                userCount, 
                productCount, 
                orderCount: stats.orderCount, 
                totalRevenue, 
                dailySales,
                topProducts,
                salesByBrand: salesByBrandRaw,
                orderStatus: orderStatusRaw,
                recentActivity: convertedActivity 
            },
            filters: {
                dateRange: dateRange || '',
                status: status || 'All'
            }
        });

    } catch (err) { 
        console.error("Admin Dashboard Error:", err);
        res.status(500).send("Error loading dashboard."); 
    }
});

// --- REPORT EXPORT ROUTES (XLSX) ---

// Export Daily Sales
router.get('/admin/reports/export/daily-sales', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const { dateRange, status } = req.query;
        const matchQuery = buildDashboardQuery(dateRange, status);

        const dailySalesRaw = await db.collection('orders').aggregate([
            { $match: matchQuery },
            { 
                $group: { 
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$orderDate" } },
                    revenue: { $sum: "$total" },
                    orders: { $sum: 1 }
                } 
            },
            { $sort: { _id: 1 } }
        ]).toArray();

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Daily Sales');

        worksheet.columns = [
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Orders', key: 'orders', width: 10 },
            { header: 'Revenue (USD)', key: 'revenue', width: 20 }
        ];

        let totalRev = 0;
        let totalOrd = 0;

        dailySalesRaw.forEach(day => {
            worksheet.addRow({ date: day._id, orders: day.orders, revenue: day.revenue });
            totalRev += day.revenue;
            totalOrd += day.orders;
        });

        // Add Total Row
        const totalRow = worksheet.addRow({ date: 'TOTAL', orders: totalOrd, revenue: totalRev });
        totalRow.font = { bold: true };
        totalRow.getCell('revenue').numFmt = '$#,##0.00';

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=daily_sales_report.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).send("Error generating report.");
    }
});

// Export Detailed Orders
router.get('/admin/reports/export/detailed-orders', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const { dateRange, status } = req.query;
        const matchQuery = buildDashboardQuery(dateRange, status);

        const orders = await db.collection('orders').find(matchQuery).sort({ orderDate: -1 }).toArray();

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Detailed Orders');

        worksheet.columns = [
            { header: 'Order ID', key: 'id', width: 25 },
            { header: 'Date', key: 'date', width: 20 },
            { header: 'Customer Name', key: 'customer', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Total (USD)', key: 'total', width: 15 }
        ];

        orders.forEach(order => {
            worksheet.addRow({
                id: order._id.toString(),
                date: new Date(order.orderDate).toLocaleString(),
                customer: `${order.customer.firstName} ${order.customer.lastName}`,
                email: order.customer.email,
                status: order.status,
                total: order.total
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=detailed_orders_report.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error("Export Error:", err);
        res.status(500).send("Error generating report.");
    }
});

// 2. Orders List
router.get('/admin/orders', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const currency = res.locals.locationData.currency;
        const orders = await db.collection('orders').find().sort({ orderDate: -1 }).toArray();
        
        const convertedOrders = await Promise.all(orders.map(async (o) => {
            o.total = await convertCurrency(Number(o.total), currency);
            return o;
        }));

        await db.collection('orders').updateMany({ isNew: true }, { $set: { isNew: false } });
        res.render('account/admin-orders', { 
            title: "Orders", 
            view: 'admin-orders', 
            orders: convertedOrders, 
            message: req.query.message 
        });
    } catch (err) { 
        res.status(500).send("Error."); 
    }
});

// 3. Order Details
router.get('/admin/orders/:id', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const currency = res.locals.locationData.currency;
        const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id) });
        if (!order) return res.status(404).send("Not found");

        order.total = await convertCurrency(Number(order.total), currency);
        order.subtotal = await convertCurrency(Number(order.subtotal), currency);
        order.shippingCost = await convertCurrency(Number(order.shippingCost), currency);
        if(order.discount) order.discount = await convertCurrency(Number(order.discount), currency);

        order.items = await Promise.all(order.items.map(async (item) => {
            item.price = await convertCurrency(Number(item.price), currency);
            item.unitPrice = await convertCurrency(Number(item.unitPrice || (item.price/item.qty)), currency);
            return item;
        }));

        res.render('account/admin-order-detail', { 
            title: "Order Detail", 
            view: 'admin-orders', 
            order: order 
        });
    } catch (err) { 
        res.status(500).send("Error."); 
    }
});

// 4. Vouchers
router.get('/admin/vouchers', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const currency = res.locals.locationData.currency;
        const vouchers = await db.collection('vouchers').find().sort({ createdAt: -1 }).toArray();

        const convertedVouchers = await Promise.all(vouchers.map(async (v) => {
            if (v.discountType === 'flat') {
                v.discountValue = await convertCurrency(Number(v.discountValue), currency);
            }
            if(v.minOrderAmount) {
                v.minOrderAmount = await convertCurrency(Number(v.minOrderAmount), currency);
            }
            return v;
        }));

        res.render('account/admin-vouchers', {
            title: "Manage Vouchers",
            view: 'admin-vouchers',
            vouchers: convertedVouchers,
            message: req.query.message,
            error: req.query.error
        });
    } catch (err) { 
        res.status(500).send("Error loading vouchers."); 
    }
});

router.post('/admin/vouchers/create', isAdmin, async (req, res) => {
    try {
        const { code, discountType, discountValue, expiryDate, minOrderAmount, isNewUser } = req.body;
        await req.app.locals.client.db(req.app.locals.dbName).collection('vouchers').insertOne({
            code: code.toUpperCase(), discountType, discountValue: parseFloat(discountValue), expiryDate: new Date(expiryDate), 
            minOrderAmount: parseFloat(minOrderAmount) || 0, isNewUser: isNewUser === 'on', isActive: true, createdAt: new Date()
        });
        res.redirect('/account/admin/vouchers?message=Created');
    } catch (err) { res.redirect('/account/admin/vouchers?error=Failed'); }
});

router.post('/admin/vouchers/delete/:id', isAdmin, async (req, res) => {
    try {
        await req.app.locals.client.db(req.app.locals.dbName).collection('vouchers').deleteOne({ _id: new ObjectId(req.params.id) });
        res.redirect('/account/admin/vouchers?message=Deleted');
    } catch (err) { res.redirect('/account/admin/vouchers?error=Failed'); }
});

// 5. Users (List)
router.get('/admin/users', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const allUsers = await db.collection('users').find().sort({ createdAt: -1 }).toArray();
        res.render('account/user-management', { title: "User Management", users: allUsers, view: 'admin-users', message: req.query.message, error: req.query.error });
    } catch (err) { res.status(500).send("Error."); }
});

// 6. User Detail (with Converted Orders)
router.get('/admin/users/:id', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const currency = res.locals.locationData.currency;
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.params.id) });
        
        if (!user) return res.redirect('/account/admin/users?error=Not found');

        let orders = await db.collection('orders').find({ userId: user.userId }).sort({ orderDate: -1 }).toArray();
        const tickets = await db.collection('support_tickets').find({ userEmail: user.email }).toArray();

        orders = await Promise.all(orders.map(async (o) => {
            o.total = await convertCurrency(Number(o.total), currency);
            return o;
        }));

        res.render('account/admin-user-detail', {
            title: `User: ${user.firstName} ${user.lastName}`,
            view: 'admin-users',
            userDetails: user,
            orders: orders,
            tickets: tickets
        });
    } catch (err) { res.status(500).send("Error."); }
});

router.post('/admin/users/delete/:id', isAdmin, async (req, res) => {
    try {
        const result = await req.app.locals.client.db(req.app.locals.dbName).collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 1) res.redirect('/account/admin/users?message=Deleted');
        else res.redirect('/account/admin/users?error=Failed');
    } catch (err) { res.redirect('/account/admin/users?error=Error'); }
});

router.post('/admin/users/delete-multiple', isAdmin, async (req, res) => {
    try {
        let { userIds } = req.body;
        if (!userIds) return res.redirect('/account/admin/users');
        if (!Array.isArray(userIds)) userIds = [userIds];
        const result = await req.app.locals.client.db(req.app.locals.dbName).collection('users').deleteMany({ _id: { $in: userIds.map(id => new ObjectId(id)) } });
        res.redirect('/account/admin/users?message=' + encodeURIComponent(`${result.deletedCount} users deleted.`));
    } catch (err) { res.redirect('/account/admin/users?error=Error'); }
});

// 7. Inbox & Tickets
router.get('/admin/inbox', isAdmin, async (req, res) => {
    try {
        const tickets = await req.app.locals.client.db(req.app.locals.dbName).collection('support_tickets').find().sort({ updatedAt: -1 }).toArray();
        res.render('account/admin-inbox', { title: "Support Inbox", view: 'admin-inbox', tickets });
    } catch (err) { res.status(500).send("Error."); }
});

router.get('/admin/tickets/:ticketId', isAdmin, async (req, res) => {
    try {
        const ticket = await req.app.locals.client.db(req.app.locals.dbName).collection('support_tickets').findOne({ ticketId: req.params.ticketId.toUpperCase() });
        if (!ticket) return res.status(404).send("Not found");
        res.render('account/admin-ticket-detail', { title: `Ticket #${ticket.ticketId}`, view: 'admin-inbox', ticket });
    } catch (err) { res.status(500).send("Error."); }
});

router.post('/admin/tickets/:ticketId/update-status', isAdmin, async (req, res) => {
    try {
        const result = await req.app.locals.client.db(req.app.locals.dbName).collection('support_tickets').findOneAndUpdate(
            { ticketId: req.params.ticketId.toUpperCase() }, { $set: { status: req.body.status, updatedAt: new Date() } }, { returnDocument: 'after' }
        );
        if (result) {
             const ticketUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/support/tickets/${result.ticketId}?email=${encodeURIComponent(result.userEmail)}`;
            await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL, to: result.userEmail, subject: `Ticket Updated`, html: `<p>Status: ${req.body.status}</p><p><a href="${ticketUrl}">View</a></p>` });
        }
        res.redirect(`/account/admin/tickets/${req.params.ticketId}`);
    } catch (err) { res.redirect(`/account/admin/tickets/${req.params.ticketId}?error=Failed`); }
});

// 8. Sales
router.get('/admin/sales', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const products = await db.collection('products').find().sort({ name: 1 }).toArray();
        const sales = await db.collection('sales').find().sort({ startDate: -1 }).toArray();
        res.render('account/admin-sales', { title: "Sales Management", view: 'admin-sales', products, sales, message: req.query.message, error: req.query.error });
    } catch (err) { res.status(500).send("Error."); }
});

router.post('/admin/sales/create', isAdmin, async (req, res) => {
    try {
        const { saleName, discountPercentage, startDate, endDate, productIds } = req.body;
        if (!saleName || !discountPercentage || !startDate || !endDate || !productIds) return res.redirect('/account/admin/sales?error=Missing fields');
        const pIds = Array.isArray(productIds) ? productIds : [productIds];
        await req.app.locals.client.db(req.app.locals.dbName).collection('sales').insertOne({
            name: saleName, discountPercentage: parseInt(discountPercentage), startDate: new Date(startDate), endDate: new Date(endDate), productIds: pIds.map(id => new ObjectId(id)), createdAt: new Date()
        });
        res.redirect('/account/admin/sales?message=Created');
    } catch (err) { res.redirect('/account/admin/sales?error=Error'); }
});

// Order Status Updates
router.post('/admin/orders/update-status/:id', isAdmin, async (req, res) => {
    try {
        const result = await req.app.locals.client.db(req.app.locals.dbName).collection('orders').findOneAndUpdate(
            { _id: new ObjectId(req.params.id) }, { $set: { status: req.body.newStatus } }, { returnDocument: 'after' }
        );
        if(result) {
             await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL, to: result.customer.email, subject: 'Order Status Update', html: createStatusEmailHtml(result) });
        }
        res.redirect('/account/admin/orders?message=Updated');
    } catch (err) { res.status(500).send("Error."); }
});

router.post('/admin/orders/cancel/:id', isAdmin, async (req, res) => {
    try {
        await req.app.locals.client.db(req.app.locals.dbName).collection('orders').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: 'Cancelled' } });
        res.redirect('/account/admin/orders?message=Cancelled');
    } catch (err) { res.status(500).send("Error."); }
});

module.exports = router;