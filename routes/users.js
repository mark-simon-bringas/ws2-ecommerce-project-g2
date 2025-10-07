const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { title } = require('process');
const saltRounds = 12;
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const verifyTurnstile = require('../utils/turnstileVerify'); // Import the helper function

// Show registration form
router.get('/register', (req, res) => {
    res.render('register', { 
        title: "Register",
        errors: [],
        page: 'auth',
        turnstileSiteKey: process.env.TURNSTILE_SITEKEY // Pass site key to the view
    });
});

// Handle registration form submission
router.post('/register', async (req, res) => {
    try {
        // --- Turnstile Verification ---
        const token = req.body['cf-turnstile-response']; 
        const ip = req.ip;
        const result = await verifyTurnstile(token, ip);

        if (!result.success) { 
            // If verification fails, re-render the form with an error.
            return res.status(400).render('register', { 
                title: "Register",
                errors: [{ msg: 'Human verification failed. Please try again.' }],
                page: 'auth',
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
                turnstileSiteKey: process.env.TURNSTILE_SITEKEY
            });
        }
        // --- End Verification ---

        const { v4: uuidv4 } = await import('uuid');
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        const existingUser = await usersCollection.findOne({ email: req.body.email });
        if (existingUser) {
            return res.status(400).render('register', {
                title: "Register",
                errors: [{ msg: "An account with this email already exists." }],
                page: 'auth',
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
                turnstileSiteKey: process.env.TURNSTILE_SITEKEY
            });
        }

        let pwdStrength = [];
        const userPassword = (req.body.password || '').toString().trim();
        const confirmPassword = (req.body.confirmPassword || '').toString().trim();

        if (userPassword.length < 8) { pwdStrength.push({ msg: "Password length should be at least 8 characters." }) }
        if (!/[A-Z]/.test(userPassword)) { pwdStrength.push({ msg: "Password must contain at least one uppercase letter." }); }
        if (!/[a-z]/.test(userPassword)) { pwdStrength.push({ msg: "Password must contain at least one lowercase letter." }); }
        if (!/[0-9]/.test(userPassword)) { pwdStrength.push({ msg: "Password must contain at least one number." }); }
        if (!/[!@#$%^&*()_\+\-=\[\]{};':\"\\|,.<>\/?`~]/.test(userPassword)) { pwdStrength.push({ msg: "Password must contain at least one special character." }); }
        if (userPassword !== confirmPassword) { pwdStrength.push({ msg: "Passwords do not match." }); }

        if (pwdStrength.length > 0) {
            return res.status(400).render('register', {
                title: "Register",
                errors: pwdStrength,
                page: 'auth',
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
                turnstileSiteKey: process.env.TURNSTILE_SITEKEY
            });
        }

        const hashedPassword = await bcrypt.hash(userPassword, saltRounds);
        const currentDate = new Date();
        const verificationToken = uuidv4();

        const newUser = {
            userId: uuidv4(),
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            passwordHash: hashedPassword,
            role: 'customer',
            accountStatus: 'active',
            isEmailVerified: false,
            verificationToken: verificationToken,
            tokenExpiry: new Date(Date.now() + 3600000),
            wishlist: [],
            createdAt: currentDate,
            updatedAt: currentDate
        };

        await usersCollection.insertOne(newUser);
        
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const verificationUrl = `${baseUrl}/users/verify/${verificationToken}`;

        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: newUser.email,
            subject: 'Verify your account',
            html: `<h2>Welcome, ${newUser.firstName}!</h2><p>Thank you for registering. Please verify your email by clicking the link below:</p><a href="${verificationUrl}">${verificationUrl}</a>`
        });

        res.render('registration-success', { title: "Success!" });

    } catch (err) {
        console.error("Error saving user:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Show login form
router.get('/login', (req, res) => {
    let message = '';
    if (req.query.status === 'loggedout') {
        message = 'You have been logged out.';
    }
    res.render('login', { 
        title: "Login",
        message: message,
        error: req.query.error,
        redirect: req.query.redirect, 
        page: 'auth',
        turnstileSiteKey: process.env.TURNSTILE_SITEKEY // Pass site key to the view
    });
});

// Handle login form submission
router.post('/login', async (req, res) => {
    try {
        // --- Turnstile Verification ---
        const token = req.body['cf-turnstile-response']; 
        const ip = req.ip;
        const result = await verifyTurnstile(token, ip); 

        if (!result.success) { 
             return res.status(401).render('login', { 
                title: "Login",
                error: 'Human verification failed. Please try again.',
                redirect: req.body.redirect,
                page: 'auth',
                turnstileSiteKey: process.env.TURNSTILE_SITEKEY
            });
        }
        // --- End Verification ---
        
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ email: req.body.email });
        
        const isPasswordValid = user ? await bcrypt.compare(req.body.password, user.passwordHash) : false;

        if (!user || !isPasswordValid) {
            return res.status(401).render('login', {
                title: "Login",
                error: 'Invalid email or password.',
                redirect: req.body.redirect,
                page: 'auth',
                turnstileSiteKey: process.env.TURNSTILE_SITEKEY
            });
        }
        
        if (!user.isEmailVerified) {
             return res.status(401).render('login', {
                title: "Login",
                error: 'Please verify your email before logging in.',
                redirect: req.body.redirect,
                page: 'auth',
                turnstileSiteKey: process.env.TURNSTILE_SITEKEY
            });
        }

        if (user.accountStatus !== 'active') {
             return res.status(403).render('login', {
                title: "Login",
                error: 'This account is not active.',
                redirect: req.body.redirect,
                page: 'auth',
                turnstileSiteKey: process.env.TURNSTILE_SITEKEY
            });
        }

        req.session.user = {
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            isEmailVerified: user.isEmailVerified
        };
        
        const redirectUrl = req.body.redirect || '/account';
        res.redirect(redirectUrl);

    } catch (err) {
        console.error("Error during login:", err);
        res.status(500).redirect('/users/login?error=' + encodeURIComponent('An unexpected error occurred.'));
    }
});

// Email Verification Route
router.get('/verify/:token', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ verificationToken: req.params.token });

        if (!user) {
            return res.send("Invalid or expired verification link.");
        }
        if (user.tokenExpiry < new Date()) {
            return res.send("Verification link has expired. Please register again.");
        }

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

// Old dashboard route now redirects to /account
router.get('/dashboard', (req, res) => {
    res.redirect('/account');
});

// Old admin route now redirects to the admin section of the account page
router.get('/admin', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/users/login');
    }
    res.redirect('/account/admin'); 
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