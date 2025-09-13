const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { Resend } = require('resend');
const bcrypt = require('bcrypt');
const saltRounds = 12;

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper function to create a consistent, beautiful email template for status updates
const createStatusEmailHtml = (title, message, order) => {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f7; }
                .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; padding: 40px; }
                .header { text-align: center; margin-bottom: 30px; }
                .header h1 { color: #1d1d1f; margin: 0; }
                .message-body { font-size: 1.1em; color: #1d1d1f; line-height: 1.5; text-align: center; }
                .details { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; }
                .details p { margin: 5px 0; color: #6e6e73; }
                .details strong { color: #1d1d1f; }
                .footer { text-align: center; margin-top: 30px; color: #86868b; font-size: 0.8em; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>sneakslab</h1>
                </div>
                <h2 style="text-align: center; color: #1d1d1f;">${title}</h2>
                <div class="message-body">
                    ${message}
                </div>
                <div class="details">
                    <p><strong>Order ID:</strong> ${order._id}</p>
                    <p><strong>Order Date:</strong> ${new Date(order.orderDate).toLocaleDateString()}</p>
                </div>
                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} sneakslab. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

// Middleware to check if the user is logged in
const isLoggedIn = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/users/login');
    }
    res.locals.user = req.session.user;
    res.locals.currentUser = req.session.user;
    next();
};

// Middleware to check if the user is an admin
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send("Access Denied: You do not have permission to view this page.");
};

// Use isLoggedIn middleware for all /account routes
router.use(isLoggedIn);

// GET /account -> Redirect to the default dashboard view
router.get('/', (req, res) => {
    if (req.session.user.role === 'admin') {
        res.redirect('/account/admin/dashboard');
    } else {
        res.redirect('/account/orders');
    }
});


// POST /account/wishlist/toggle
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


// GET /account/wishlist - Display the user's wishlist page
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


// UPDATED: /account/admin/dashboard to include activity log
router.get('/admin/dashboard', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const productsCollection = db.collection('products');
        const ordersCollection = db.collection('orders');
        const activityLogCollection = db.collection('activity_log');

        const [
            userCount, 
            productCount, 
            orderCount, 
            revenueResult,
            recentOrders,
            recentActivityLogs
        ] = await Promise.all([
            usersCollection.countDocuments(),
            productsCollection.countDocuments(),
            ordersCollection.countDocuments(),
            ordersCollection.aggregate([
                { $group: { _id: null, totalRevenue: { $sum: "$total" } } }
            ]).toArray(),
            ordersCollection.find().sort({ orderDate: -1 }).limit(5).toArray(),
            activityLogCollection.find().sort({ timestamp: -1 }).limit(5).toArray()
        ]);
        
        // Combine and sort recent activities
        const normalizedOrders = recentOrders.map(order => ({
            type: 'ORDER',
            timestamp: order.orderDate,
            data: order
        }));
        const normalizedLogs = recentActivityLogs.map(log => ({
            type: 'IMPORT',
            timestamp: log.timestamp,
            data: log
        }));

        const combinedActivity = [...normalizedOrders, ...normalizedLogs]
            .sort((a, b) => b.timestamp - a.timestamp) // Sort descending by timestamp
            .slice(0, 5); // Get the 5 most recent activities

        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        res.render('account/dashboard', {
            title: "Admin Dashboard",
            view: 'admin-dashboard',
            data: { 
                userCount,
                productCount,
                orderCount,
                totalRevenue,
                recentActivity: combinedActivity // Pass the new combined feed
            }
        });

    } catch (err) {
        console.error("Error fetching admin dashboard data:", err);
        res.status(500).send("Could not load the admin dashboard.");
    }
});

// GET /account/admin/orders - List all orders for the admin
router.get('/admin/orders', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const allOrders = await ordersCollection.find().sort({ orderDate: -1 }).toArray();

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

// GET /account/admin/orders/:id - View a single order's details
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

// POST /account/admin/orders/update-status/:id - Update an order's status
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
            let emailMessage = '';

            switch(newStatus) {
                case 'Processing':
                    emailTitle = 'Your Order is Being Processed';
                    emailMessage = `Hi ${updatedOrder.customer.firstName}, we're getting your order ready. We'll notify you again once it has shipped.`;
                    break;
                case 'Shipped':
                    emailTitle = 'Your Order Has Shipped!';
                    emailMessage = `Good news, ${updatedOrder.customer.firstName}! Your order is on its way.`;
                    break;
                case 'Delivered':
                    emailTitle = 'Your Order Has Been Delivered';
                    emailMessage = `Hi ${updatedOrder.customer.firstName}, your order has been delivered. We hope you enjoy it!`;
                    break;
            }

            if (emailTitle) {
                const emailHtml = createStatusEmailHtml(emailTitle, emailMessage, updatedOrder);
                const { data, error } = await resend.emails.send({
                    from: process.env.RESEND_FROM_EMAIL,
                    to: updatedOrder.customer.email,
                    subject: emailTitle,
                    html: emailHtml,
                });
                if (error) {
                    console.error(`Resend API Error for order ${orderId}:`, error);
                }
            }
        }

        res.redirect(`/account/admin/orders?message=${encodeURIComponent('Order status updated successfully!')}`);
    } catch (err) {
        console.error("Error updating order status:", err);
        res.status(500).send("Failed to update order status.");
    }
});

// POST /account/admin/orders/cancel/:id - Cancel an order
router.post('/account/admin/orders/cancel/:id', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const orderId = req.params.id;

        const result = await ordersCollection.findOneAndUpdate(
            { _id: new ObjectId(orderId) },
            { $set: { status: 'Cancelled' } },
            { returnDocument: 'after' }
        );
        
        const cancelledOrder = result;

        if (cancelledOrder) {
            const emailTitle = 'Your Order Has Been Cancelled';
            const emailMessage = `Hi ${cancelledOrder.customer.firstName}, your order has been successfully cancelled as requested. If you have any questions, please contact our support team.`;
            const emailHtml = createStatusEmailHtml(emailTitle, emailMessage, cancelledOrder);

            const { data, error } = await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL,
                to: cancelledOrder.customer.email,
                subject: emailTitle,
                html: emailHtml,
            });
            if (error) {
                console.error(`Resend API Error for order ${orderId}:`, error);
            }
        }

        res.redirect(`/account/admin/orders?message=${encodeURIComponent('Order has been cancelled.')}`);
    } catch (err) {
        console.error("Error cancelling order:", err);
        res.status(500).send("Failed to cancel order.");
    }
});

// GET /account/orders - Show the user's order history
router.get('/orders', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const userOrders = await ordersCollection.find({ userId: req.session.user.userId }).sort({ orderDate: -1 }).toArray();

        res.render('account/order-history', {
            title: "Order History",
            orders: userOrders, 
            view: 'orders' 
        });

    } catch (err) {
        console.error("Error fetching order history:", err);
        res.status(500).send("Could not load your order history.");
    }
});

// GET /account/admin/users - Show the user management page for admins
router.get('/admin/users', isAdmin, async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const allUsers = await usersCollection.find().toArray();

        res.render('account/user-management', {
            title: "User Management",
            users: allUsers, 
            view: 'admin-users' 
        });

    } catch (err) {
        console.error("Error fetching users for admin:", err);
        res.status(500).send("Could not load user management.");
    }
});

// GET /account/settings - Show account settings page
router.get('/settings', (req, res) => {
    res.render('account/settings', {
        title: "Account Settings",
        view: 'settings',
        message: req.query.message,
        error: req.query.error
    });
});

// POST /account/settings/update-profile - Handle profile information update
router.post('/settings/update-profile', async (req, res) => {
    try {
        const { firstName, lastName } = req.body;
        const userId = req.session.user.userId;

        if (!firstName || !lastName) {
            return res.redirect('/account/settings?error=' + encodeURIComponent('First and last name cannot be empty.'));
        }

        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        await usersCollection.updateOne(
            { userId: userId },
            { $set: { firstName: firstName, lastName: lastName, updatedAt: new Date() } }
        );

        req.session.user.firstName = firstName;
        req.session.user.lastName = lastName;

        res.redirect('/account/settings?message=' + encodeURIComponent('Profile updated successfully!'));

    } catch (err) {
        console.error("Error updating profile:", err);
        res.redirect('/account/settings?error=' + encodeURIComponent('An error occurred while updating your profile.'));
    }
});

// POST /account/settings/update-password - Handle password change
router.post('/settings/update-password', async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const userId = req.session.user.userId;

        if (newPassword !== confirmPassword) {
            return res.redirect('/account/settings?error=' + encodeURIComponent('New passwords do not match.'));
        }

        const pwdStrengthErrors = [];
        if (newPassword.length < 8) { pwdStrengthErrors.push("Password must be at least 8 characters long.") }
        if (!/[A-Z]/.test(newPassword)) { pwdStrengthErrors.push("Password must contain at least one uppercase letter."); }
        if (!/[a-z]/.test(newPassword)) { pwdStrengthErrors.push("Password must contain at least one lowercase letter."); }
        if (!/[0-9]/.test(newPassword)) { pwdStrengthErrors.push("Password must contain a special character."); }
        
        if (pwdStrengthErrors.length > 0) {
            return res.redirect('/account/settings?error=' + encodeURIComponent(pwdStrengthErrors.join(' ')));
        }

        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ userId: userId });

        const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isPasswordValid) {
            return res.redirect('/account/settings?error=' + encodeURIComponent('Incorrect current password.'));
        }

        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        await usersCollection.updateOne(
            { userId: userId },
            { $set: { passwordHash: hashedPassword, updatedAt: new Date() } }
        );

        res.redirect('/account/settings?message=' + encodeURIComponent('Password updated successfully!'));

    } catch (err) {
        console.error("Error updating password:", err);
        res.redirect('/account/settings?error=' + encodeURIComponent('An error occurred while updating your password.'));
    }
});

module.exports = router;