// routes/users.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const saltRounds = 12;
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const verifyTurnstile = require('../utils/turnstileVerify');
const speakeasy = require('speakeasy');

// Show registration form
router.get('/register', (req, res) => {
    res.render('register', { 
        title: "Register",
        errors: [],
        page: 'auth',
        turnstileSiteKey: process.env.TURNSTILE_SITEKEY
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

        // --- AUTO-ASSIGN WELCOME VOUCHERS ---
        const vouchersCollection = db.collection('vouchers');
        const welcomeVouchers = await vouchersCollection.find({ isNewUser: true, isActive: true }).toArray();
        
        const userVouchers = welcomeVouchers.map(v => ({
            voucherId: v._id,
            isUsed: false,
            redeemedAt: new Date()
        }));

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
            loginHistory: [],
            vouchers: userVouchers,
            profilePictureUrl: null,
            is2FAEnabled: false, // Default to disabled
            trustedDevices: [], // Initialize trusted devices array
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
        turnstileSiteKey: process.env.TURNSTILE_SITEKEY
    });
});

// Handle login form submission
router.post('/login', async (req, res) => {
    try {
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

        // --- 2FA CHECK WITH TRUSTED DEVICE LOGIC ---
        let skip2FA = false;
        if (user.is2FAEnabled) {
            // Check if the browser has a valid trust token cookie
            // Use req.signedCookies since we set it as signed
            const trustToken = req.signedCookies ? req.signedCookies.trust_token : null;
            
            if (trustToken && user.trustedDevices) {
                const device = user.trustedDevices.find(d => d.token === trustToken);
                // Check if device exists and token is not expired
                if (device && new Date(device.expiry) > new Date()) {
                    skip2FA = true;
                }
            }

            if (!skip2FA) {
                // Store user ID in a temporary session variable for the 2nd step
                req.session.partialLoginId = user.userId;
                req.session.redirectUrl = req.body.redirect || '/account'; 
                // Also store "keep me signed in" preference temporarily
                req.session.tempKeepSignedIn = req.body.keepSignedIn; 
                
                return res.redirect('/users/login/2fa');
            }
        }

        // --- COMPLETE LOGIN (Standard or Trusted 2FA) ---
        req.session.user = {
            userId: user.userId,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            bio: user.bio, // Ensure bio is part of session
            isEmailVerified: user.isEmailVerified,
            profilePictureUrl: user.profilePictureUrl,
            is2FAEnabled: user.is2FAEnabled
        };

        // Implement "Keep Me Signed In"
        if (req.body.keepSignedIn === 'on') {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        } else {
            req.session.cookie.maxAge = 15 * 60 * 1000;
        }

        // Track Login History
        try {
            const userAgent = req.headers['user-agent'] || 'Unknown Device';
            const userIp = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
            
            await usersCollection.updateOne(
                { userId: user.userId },
                {
                    $push: {
                        loginHistory: {
                            $each: [{ userAgent, ip: userIp, timestamp: new Date() }],
                            $sort: { timestamp: -1 },
                            $slice: 5 
                        }
                    }
                }
            );
        } catch (historyErr) {
            console.error("Failed to save login history:", historyErr);
        }
        
        const redirectUrl = req.body.redirect || '/account';
        res.redirect(redirectUrl);

    } catch (err) {
        console.error("Error during login:", err);
        res.status(500).redirect('/users/login?error=' + encodeURIComponent('An unexpected error occurred.'));
    }
});

// --- 2FA Login Routes ---

// GET /users/login/2fa - Show 2FA Input Form
router.get('/login/2fa', (req, res) => {
    if (!req.session.partialLoginId) return res.redirect('/users/login');
    res.render('login-2fa', { 
        title: "Two-Factor Authentication",
        page: 'auth',
        error: req.query.error
    });
});

// POST /users/login/2fa - Verify Code
router.post('/login/2fa', async (req, res) => {
    try {
        const userId = req.session.partialLoginId;
        if (!userId) return res.redirect('/users/login');

        const { token } = req.body;
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ userId: userId });

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret.base32 || user.twoFactorSecret, // Handle object or string storage
            encoding: 'base32',
            token: token
        });

        if (verified) {
            // Complete Login
            req.session.user = {
                userId: user.userId,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role,
                bio: user.bio,
                isEmailVerified: user.isEmailVerified,
                profilePictureUrl: user.profilePictureUrl,
                is2FAEnabled: true
            };

            // Restore "Keep Me Signed In" preference
            if (req.session.tempKeepSignedIn === 'on') {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
            } else {
                req.session.cookie.maxAge = 15 * 60 * 1000;
            }
            delete req.session.tempKeepSignedIn;

            // Track Login History (2FA Success)
            try {
                const userAgent = req.headers['user-agent'] || 'Unknown Device';
                const userIp = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
                await usersCollection.updateOne(
                    { userId: user.userId },
                    {
                        $push: {
                            loginHistory: {
                                $each: [{ userAgent, ip: userIp, timestamp: new Date() }],
                                $sort: { timestamp: -1 },
                                $slice: 5 
                            }
                        }
                    }
                );
            } catch (historyErr) { console.error(historyErr); }
            
            delete req.session.partialLoginId;
            const redirectUrl = req.session.redirectUrl || '/account';
            delete req.session.redirectUrl;
            
            res.redirect(redirectUrl);
        } else {
            res.render('login-2fa', { 
                title: "Two-Factor Authentication",
                page: 'auth',
                error: "Invalid code. Please try again."
            });
        }
    } catch (err) {
        console.error("2FA Login Error:", err);
        res.redirect('/users/login');
    }
});

router.get('/verify/:token', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');
        const user = await usersCollection.findOne({ verificationToken: req.params.token });

        if (!user) return res.send("Invalid or expired verification link.");
        if (user.tokenExpiry < new Date()) return res.send("Verification link has expired. Please register again.");

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

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error("Error destroying session:", err);
        // IMPORTANT: Do NOT clear 'trust_token' cookie here.
        // We want the device to remain trusted even if the user logs out.
        // Only clear the session cookie.
        res.clearCookie('connect.sid');
        res.redirect('/users/login?status=loggedout');
    });
});

module.exports = router;