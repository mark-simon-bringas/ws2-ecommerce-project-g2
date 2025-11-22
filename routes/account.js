// routes/account.js

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { Resend } = require('resend');
const bcrypt = require('bcrypt');
const saltRounds = 12;

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper function for status emails (Keep existing logic)
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
        subMessage = `Your order #${order._id.toString().slice(-7).toUpperCase()} has been successfully cancelled. You have not been charged.`;
    }

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f7; color: #1d1d1f; }
                .container { max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 40px; }
                .header { text-align: center; border-bottom: 1px solid #d2d2d7; padding-bottom: 20px; margin-bottom: 20px;}
                .header h1 { font-size: 24px; }
                .items-table { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 20px; }
                .info-grid { display: table; width: 100%; margin-top: 30px; border-collapse: separate; border-spacing: 20px 0;}
                .info-column { display: table-cell; width: 50%; vertical-align: top; }
                .info-column h3 { font-size: 1em; margin-bottom: 10px;}
                .footer { text-align: center; margin-top: 30px; font-size: 0.8em; color: #86868b; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>${headerMessage}</h1>
                    <p>${subMessage}</p>
                </div>
                <table class="items-table">
                    ${itemsHtml}
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
};

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

// UPDATED: Main Account Redirect
router.get('/', (req, res) => {
    if (req.session.user.role === 'admin') {
        res.redirect('/account/admin/dashboard');
    } else {
        // Redirect normal users to the new Settings Menu Hub
        res.redirect('/account/settings');
    }
});

// --- NEW: SETTINGS HUB & SUB-PAGES ---

// 1. Settings Menu (The Hub)
router.get('/settings', async (req, res) => {
    // No DB call needed, just render the menu with session data
    res.render('account/settings-menu', {
        title: "Settings",
        view: 'settings'
    });
});

// 2. Identity Page
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

// 3. Security Page
router.get('/security', async (req, res) => {
    res.render('account/settings-security', {
        title: "Security",
        view: 'settings',
        message: req.query.message,
        error: req.query.error
    });
});

// 4. Addresses Page
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


// --- EXISTING LOGIC (Refactored paths where needed) ---

router.post('/wishlist/toggle', async (req, res) => {
    try {
        const { productId } = req.body;
        const userId = req.session.user.userId;
        const productObjectId = new ObjectId(productId);

        if (!productId) {
            return res.status(400).json({ success: false, message: 'Product ID is required.' });
        }

        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ userId: userId });
        const isWishlisted = user && user.wishlist && user.wishlist.some(id => id.equals(productObjectId));

        let updateOperation;
        let newStatus;

        if (isWishlisted) {
            updateOperation = { $pull: { wishlist: productObjectId } };
            newStatus = 'removed';
        } else {
            updateOperation = { $addToSet: { wishlist: productObjectId } };
            newStatus = 'added';
        }

        await usersCollection.updateOne({ userId: userId }, updateOperation);

        res.json({ success: true, newStatus: newStatus });

    } catch (err) {
        console.error("Error toggling wishlist item:", err);
        res.status(500).json({ success: false, message: 'An error occurred.' });
    }
});

router.get('/wishlist', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const productsCollection = db.collection('products');
        
        const user = await usersCollection.findOne({ userId: req.session.user.userId });
        
        let wishlistedProducts = [];
        let userWishlist = [];
        if (user && user.wishlist && user.wishlist.length > 0) {
            userWishlist = user.wishlist;
            wishlistedProducts = await productsCollection.find({
                _id: { $in: user.wishlist }
            }).toArray();
        }

        res.render('account/wishlist', {
            title: "My Wishlist",
            view: 'wishlist',
            products: wishlistedProducts,
            wishlist: userWishlist
        });

    } catch (err) {
        console.error("Error fetching wishlist:", err);
        res.status(500).send("Could not load your wishlist.");
    }
});

router.get('/orders', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const userOrders = await db.collection('orders').find({ userId: req.session.user.userId }).sort({ orderDate: -1 }).toArray();
        res.render('account/order-history', { title: "Order History", orders: userOrders, view: 'orders' });
    } catch (err) {
        console.error("Error fetching order history:", err);
        res.status(500).send("Could not load your order history.");
    }
});

// --- FORM ACTIONS (Redirects updated to new paths) ---

router.post('/settings/update-profile', async (req, res) => {
    try {
        const { firstName, lastName } = req.body;
        const userId = req.session.user.userId;
        if (!firstName || !lastName) { return res.redirect('/account/identity?error=' + encodeURIComponent('First and last name cannot be empty.')); }
        const db = req.app.locals.client.db(req.app.locals.dbName);
        await db.collection('users').updateOne(
            { userId: userId },
            { $set: { firstName: firstName, lastName: lastName, updatedAt: new Date() } }
        );
        req.session.user.firstName = firstName;
        req.session.user.lastName = lastName;
        res.redirect('/account/identity?message=' + encodeURIComponent('Profile updated successfully!'));
    } catch (err) {
        console.error("Error updating profile:", err);
        res.redirect('/account/identity?error=' + encodeURIComponent('An error occurred while updating your profile.'));
    }
});

router.post('/settings/update-password', async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const userId = req.session.user.userId;
        if (newPassword !== confirmPassword) { return res.redirect('/account/security?error=' + encodeURIComponent('New passwords do not match.')); }
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const user = await db.collection('users').findOne({ userId: userId });
        const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isPasswordValid) { return res.redirect('/account/security?error=' + encodeURIComponent('Incorrect current password.')); }
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        await db.collection('users').updateOne(
            { userId: userId },
            { $set: { passwordHash: hashedPassword, updatedAt: new Date() } }
        );
        res.redirect('/account/security?message=' + encodeURIComponent('Password updated successfully!'));
    } catch (err) {
        console.error("Error updating password:", err);
        res.redirect('/account/security?error=' + encodeURIComponent('An error occurred while updating your password.'));
    }
});

router.post('/settings/add-address', async (req, res) => {
    try {
        const { v4: uuidv4 } = await import('uuid');
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const userId = req.session.user.userId;
        const newAddress = {
            addressId: uuidv4(), firstName: req.body.firstName, lastName: req.body.lastName,
            address: req.body.address, country: req.body.country, state: req.body.state,
            zip: req.body.zip, phone: req.body.phone, isDefault: req.body.isDefault === 'on'
        };
        if (newAddress.isDefault) { await db.collection('users').updateOne({ userId: userId }, { $set: { "addresses.$[].isDefault": false } }); }
        await db.collection('users').updateOne({ userId: userId }, { $push: { addresses: newAddress } });
        res.redirect('/account/addresses?message=' + encodeURIComponent('Address added successfully!'));
    } catch (err) {
        console.error("Error adding address:", err);
        res.redirect('/account/addresses?error=' + encodeURIComponent('Could not add address.'));
    }
});

router.post('/settings/edit-address/:addressId', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const userId = req.session.user.userId;
        const { addressId } = req.params;
        const updatedAddress = {
            addressId: addressId, firstName: req.body.firstName, lastName: req.body.lastName,
            address: req.body.address, country: req.body.country, state: req.body.state,
            zip: req.body.zip, phone: req.body.phone, isDefault: req.body.isDefault === 'on'
        };
        if (updatedAddress.isDefault) { await db.collection('users').updateOne({ userId: userId }, { $set: { "addresses.$[].isDefault": false } }); }
        await db.collection('users').updateOne({ userId: userId, "addresses.addressId": addressId }, { $set: { "addresses.$": updatedAddress } });
        res.redirect('/account/addresses?message=' + encodeURIComponent('Address updated successfully!'));
    } catch (err) {
        console.error("Error updating address:", err);
        res.redirect('/account/addresses?error=' + encodeURIComponent('Could not update address.'));
    }
});

router.post('/settings/delete-address/:addressId', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const userId = req.session.user.userId;
        const { addressId } = req.params;
        await db.collection('users').updateOne({ userId: userId }, { $pull: { addresses: { addressId: addressId } } });
        res.redirect('/account/addresses?message=' + encodeURIComponent('Address removed successfully!'));
    } catch (err) {
        console.error("Error deleting address:", err);
        res.redirect('/account/addresses?error=' + encodeURIComponent('Could not remove address.'));
    }
});

// --- ADMIN ROUTES (Kept as is, essentially) ---
// ... [Admin routes logic remains the same, just ensuring no overlap] ...
router.get('/admin/dashboard', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const productsCollection = db.collection('products');
        const ordersCollection = db.collection('orders');

        const recentActivityPipeline = [
            { $sort: { orderDate: -1 } },
            { $limit: 10 },
            { $project: { type: 'ORDER', timestamp: '$orderDate', data: '$$ROOT' } },
            { $unionWith: { 
                coll: 'activity_log', 
                pipeline: [
                    { $sort: { timestamp: -1 } },
                    { $limit: 10 },
                    { $project: { type: '$actionType', timestamp: '$timestamp', data: '$$ROOT' } }
                ]
            }},
            { $sort: { timestamp: -1 } },
            { $limit: 5 }
        ];

        const [
            userCount, 
            productCount, 
            orderCount, 
            revenueResult,
            recentActivity
        ] = await Promise.all([
            usersCollection.countDocuments(),
            productsCollection.countDocuments(),
            ordersCollection.countDocuments(),
            ordersCollection.aggregate([
                { $group: { _id: null, totalRevenue: { $sum: "$total" } } }
            ]).toArray(),
            ordersCollection.aggregate(recentActivityPipeline).toArray()
        ]);
        
        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        res.render('account/dashboard', {
            title: "Admin Dashboard",
            view: 'admin-dashboard',
            data: { 
                userCount,
                productCount,
                orderCount,
                totalRevenue,
                recentActivity: recentActivity
            }
        });

    } catch (err) {
        console.error("Error fetching admin dashboard data:", err);
        res.status(500).send("Could not load the admin dashboard.");
    }
});

router.get('/admin/orders', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        
        const allOrders = await ordersCollection.find().sort({ orderDate: -1 }).toArray();

        await ordersCollection.updateMany({ isNew: true }, { $set: { isNew: false } });

        res.render('account/admin-orders', {
            title: "Order Management",
            view: 'admin-orders',
            orders: allOrders,
            message: req.query.message
        });
    } catch (err) {
        console.error("Error fetching all orders:", err);
        res.status(500).send("Could not load order management page.");
    }
});

router.get('/admin/orders/:id', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const orderId = req.params.id;

        const order = await ordersCollection.findOne({ _id: new ObjectId(orderId) });
        if (!order) {
            return res.status(404).send("Order not found.");
        }

        res.render('account/admin-order-detail', {
            title: `Order #${order._id.toString().slice(-6)}`,
            view: 'admin-orders',
            order: order
        });
    } catch (err) {
        console.error("Error fetching order details:", err);
        res.status(500).send("Could not load order details.");
    }
});

router.post('/admin/orders/update-status/:id', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const orderId = req.params.id;
        const { newStatus } = req.body;

        const result = await ordersCollection.findOneAndUpdate(
            { _id: new ObjectId(orderId) },
            { $set: { status: newStatus } },
            { returnDocument: 'after' }
        );

        const updatedOrder = result;

        if (updatedOrder) {
            let emailTitle = '';
            if (newStatus === 'Shipped') emailTitle = 'Your Order Has Shipped!';
            if (newStatus === 'Delivered') emailTitle = 'Your Order Has Been Delivered';

            if (emailTitle) {
                const emailHtml = createStatusEmailHtml(updatedOrder);
                await resend.emails.send({
                    from: process.env.RESEND_FROM_EMAIL,
                    to: updatedOrder.customer.email,
                    subject: emailTitle,
                    html: emailHtml,
                });
            }
        }
        res.redirect(`/account/admin/orders?message=${encodeURIComponent('Order status updated successfully!')}`);
    } catch (err) {
        console.error("Error updating order status:", err);
        res.status(500).send("Failed to update order status.");
    }
});

router.post('/admin/orders/cancel/:id', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const activityLogCollection = db.collection('activity_log');
        const orderId = req.params.id;
        
        await ordersCollection.updateOne({ _id: new ObjectId(orderId) }, { $set: { status: 'Cancelled' } });
        const updatedOrderForEmail = await ordersCollection.findOne({ _id: new ObjectId(orderId) });

        if (updatedOrderForEmail) {
            await activityLogCollection.insertOne({
                userId: req.session.user.userId, userFirstName: req.session.user.firstName, userRole: req.session.user.role,
                actionType: 'ORDER_CANCEL',
                details: { orderId: updatedOrderForEmail._id, customerName: `${updatedOrderForEmail.customer.firstName} ${updatedOrderForEmail.customer.lastName}` },
                timestamp: new Date()
            });
            const emailHtml = createStatusEmailHtml(updatedOrderForEmail);
            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL, to: updatedOrderForEmail.customer.email,
                subject: 'Your Order Has Been Cancelled', html: emailHtml,
            });
        }
        res.redirect(`/account/admin/orders?message=${encodeURIComponent('Order has been cancelled.')}`);
    } catch (err) {
        console.error("Error cancelling order:", err);
        res.status(500).send("Failed to cancel order.");
    }
});

router.get('/admin/users', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const allUsers = await db.collection('users').find().toArray();
        res.render('account/user-management', { title: "User Management", users: allUsers, view: 'admin-users' });
    } catch (err) {
        console.error("Error fetching users for admin:", err);
        res.status(500).send("Could not load user management.");
    }
});

router.get('/admin/inbox', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const tickets = await db.collection('support_tickets').find().sort({ updatedAt: -1 }).toArray();
        res.render('account/admin-inbox', {
            title: "Support Inbox",
            view: 'admin-inbox',
            tickets: tickets
        });
    } catch (err) {
        console.error("Error fetching support tickets:", err);
        res.status(500).send("Could not load support inbox.");
    }
});

router.get('/admin/tickets/:ticketId', isAdmin, async (req, res) => {
    try {
        const { ticketId } = req.params;
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticket = await db.collection('support_tickets').findOne({ ticketId: ticketId.toUpperCase() });

        if (!ticket) {
            return res.status(404).send("Ticket not found.");
        }
        res.render('account/admin-ticket-detail', {
            title: `Ticket #${ticket.ticketId}`,
            view: 'admin-inbox',
            ticket: ticket
        });
    } catch (err) {
        console.error("Error fetching ticket details:", err);
        res.status(500).send("Could not load ticket details.");
    }
});

router.post('/admin/tickets/:ticketId/update-status', isAdmin, async (req, res) => {
    const { ticketId } = req.params;
    const { status } = req.body;
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('support_tickets');
        
        const result = await ticketsCollection.findOneAndUpdate(
            { ticketId: ticketId.toUpperCase() },
            { $set: { status: status, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );
        const ticket = result;

        if (ticket) {
             const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
             const ticketUrl = `${baseUrl}/support/tickets/${ticket.ticketId}?email=${encodeURIComponent(ticket.userEmail)}`;
            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL,
                to: ticket.userEmail,
                subject: `Your Support Ticket [${ticket.ticketId}] has been updated`,
                html: `<p>An agent has updated the status of your ticket to: <strong>${status}</strong>.</p><p>You can view the full conversation and reply by clicking the link below:</p><a href="${ticketUrl}">View Your Ticket</a>`
            });
        }
        
        res.redirect(`/account/admin/tickets/${ticketId}`);
    } catch (err) {
        console.error("Error updating ticket status:", err);
        res.redirect(`/account/admin/tickets/${ticketId}?error=` + encodeURIComponent('Failed to update status.'));
    }
});

router.get('/admin/sales', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const products = await db.collection('products').find().sort({ name: 1 }).toArray();
        const sales = await db.collection('sales').find().sort({ startDate: -1 }).toArray();

        res.render('account/admin-sales', {
            title: "Sales Management",
            view: 'admin-sales',
            products: products,
            sales: sales,
            message: req.query.message,
            error: req.query.error
        });
    } catch (err) {
        console.error("Error fetching sales data:", err);
        res.status(500).send("Could not load sales management page.");
    }
});

router.post('/admin/sales/create', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const { saleName, discountPercentage, startDate, endDate, productIds } = req.body;

        if (!saleName || !discountPercentage || !startDate || !endDate || !productIds) {
            return res.redirect('/account/admin/sales?error=' + encodeURIComponent('All fields are required.'));
        }

        const productObjectIds = Array.isArray(productIds) ? productIds.map(id => new ObjectId(id)) : [new ObjectId(productIds)];

        const newSale = {
            name: saleName,
            discountPercentage: parseInt(discountPercentage, 10),
            startDate: new Date(startDate),
            endDate: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
            productIds: productObjectIds,
            createdAt: new Date()
        };

        await db.collection('sales').insertOne(newSale);
        res.redirect('/account/admin/sales?message=' + encodeURIComponent('Sale created successfully!'));

    } catch (err) {
        console.error("Error creating sale:", err);
        res.redirect('/account/admin/sales?error=' + encodeURIComponent('An error occurred.'));
    }
});

module.exports = router;