const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { title } = require('process');
const saltRounds = 12;
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Show registration form
router.get('/register', (req, res) => {
    res.render('register', { 
        title: "Register",
        errors: []
    });
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

        // Normalize inputs and password strength checker
        let pwdStrength = [];
        const userPassword = (req.body.password || '').toString().trim();
        const confirmPassword = (req.body.confirmPassword || '').toString().trim();

        if (userPassword.length < 8) {
            pwdStrength.push("Password length should be greater than 8.")
        }
        if (!/[A-Z]/.test(userPassword)) {
            pwdStrength.push("Password must contain at least one uppercase letter.");
        }
        if (!/[a-z]/.test(userPassword)) {
            pwdStrength.push("Password must contain at least one lowercase letter.");
        }
        if (!/[0-9]/.test(userPassword)) {
            pwdStrength.push("Password must contain at least one number.");
        }
        if (!/[!@#$%^&*()_\+\-=\[\]{};':\"\\|,.<>\/?`~]/.test(userPassword)) {
            pwdStrength.push("Password must contain at least one special character.");
        }
        if (userPassword !== confirmPassword) {
            pwdStrength.push("Passwords do not match.");
        }

        // If password contains error(s)
        if (pwdStrength.length > 0) {
            return res.status(400).render('register', {
                title: "Register",
                errors: pwdStrength
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(userPassword, saltRounds);
        const currentDate = new Date();

        // Create verification token
        const token = uuidv4();

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
            verificationToken: token,
            tokenExpiry: new Date(Date.now() + 3600000),
            createdAt: currentDate,
            updatedAt: currentDate
        };

        // Insert into MongoDB
        await usersCollection.insertOne(newUser);
        
        // Build dynamic verification URL
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const verificationUrl = `${baseUrl}/users/verify/${token}`;

        // Send verification email using Resend
        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: newUser.email,
            subject: 'Verify your account',
            html: `
                <h2>Welcome, ${newUser.firstName}!</h2>
                <p>Thank you for registering. Please verify your email by clicking the link below:</p>
                <a href="${verificationUrl}">${verificationUrl}</a>
            `
        });

        // Redirect to a success page or login
        res.render('registration-success', { title: "Success!" });

    } catch (err) {
        console.error("Error saving user:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Show login form
router.get('/login', (req, res) => {
    let message = '';
    // Check if there's a status query parameter indicating a successful logout
    if (req.query.status === 'loggedout') {
        message = 'You have been logged out.';
    }
    res.render('login', { 
        title: "Login",
        message: message // Pass the message to the view
    });
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

        //Check if user email is verified
        if (!user.isEmailVerified) {
            return res.send("Please verify your email before logging in.");
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
                role: user.role,
                isEmailVerified: user.isEmailVerified
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

// Email Verification Route
router.get('/verify/:token', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        // Find user by token
            const user = await usersCollection.findOne({ verificationToken: req.params.token });
        // Check if token exists
        if (!user) {
            return res.send("Invalid or expired verification link.");
        
        }
    // Check if token is still valid
        if (user.tokenExpiry < new Date()) {
            return res.send("Verification link has expired. Please register again.");
        }
    // Update user as verified
    await usersCollection.updateOne(
        { verificationToken: req.params.token },
        { $set: { isEmailVerified: true }, $unset: { verificationToken: "", tokenExpiry: "" } }
    );

    res.render('user-verified', { title: "Email Verified!" });

    } catch (err) {
        console.error("Error verifying user:", err);
        res.send("Something went wrong during verification.");
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
            console.error("Error destroying session:", err);
            return res.send("Something went wrong during logout.");
        }
        res.clearCookie('connect.sid');
     
        res.redirect('/users/login?status=loggedout');
    });
});

module.exports = router;