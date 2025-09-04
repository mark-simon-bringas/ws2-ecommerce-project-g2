const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const saltRounds = 12;

// Show registration form
router.get('/register', (req, res) => {
    res.render('register', { title: "Register" });
});

// Handle registration form submission
router.post('/register', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        // Check if email already exists
        const existingUser = await usersCollection.findOne({ email: req.body.email });
        if (existingUser) {
            return res.status(400).send("User already exists with this email.");
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);
        const currentDate = new Date();

        // Build new user object
        const newUser = {
            userId: uuidv4(),
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            passwordHash: hashedPassword,
            role: 'customer', // default role
            accountStatus: 'active',
            isEmailVerified: false,
            createdAt: currentDate,
            updatedAt: currentDate
        };

        // Insert into MongoDB
        await usersCollection.insertOne(newUser);
        
        // Redirect to a success page or login
        res.render('registration-success', { title: "Success!" });

    } catch (err) {
        console.error("Error saving user:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Show login form
router.get('/login', (req, res) => {
    res.render('login', { title: "Login" });
});

// Handle login form submission
router.post('/login', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        // Find user by email
        const user = await usersCollection.findOne({ email: req.body.email });
        if (!user) {
            return res.status(404).send("User not found.");
        }

        // Check if account is active
        if (user.accountStatus !== 'active') {
            return res.status(403).send("Account is not active.");
        }

        // Compare hashed password
        const isPasswordValid = await bcrypt.compare(req.body.password, user.passwordHash);
        if (isPasswordValid) {
            // Store user info in session
            req.session.user = {
                userId: user.userId,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role
            };
            res.redirect('/users/dashboard');
        } else {
            res.status(401).send("Invalid credentials.");
        }
    } catch (err) {
        console.error("Error during login:", err);
        res.status(500).send("Something went wrong during login.");
    }
});

// Dashboard route (requires login)
router.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/users/login');
    }
    res.render('dashboard', { title: "User Dashboard", user: req.session.user });
});

// Admin dashboard route (requires admin role)
router.get('/admin', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied. Admins only.");
    }
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const users = await db.collection('users').find().toArray();
        res.render('admin', {
            title: "Admin Dashboard",
            users,
            currentUser: req.session.user
        });
    } catch (err) {
        console.error("Error fetching users for admin dashboard:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Logout route
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/users/dashboard');
        }
        res.clearCookie('connect.sid');
        res.redirect('/users/login');
    });
});

module.exports = router;