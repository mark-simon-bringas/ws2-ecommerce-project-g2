// routes/users.js

// --------------------------------------------------
// DEPENDENCIES
// --------------------------------------------------

const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const router = express.Router();
<<<<<<< Updated upstream

// --------------------------------------------------
// MONGODB SETUP
// --------------------------------------------------

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);
const dbName = "ecommerceDB";

// --------------------------------------------------
// REGISTRATION ROUTES
// --------------------------------------------------
=======
const bcrypt = require('bcrypt');
const { title } = require('process');
const saltRounds = 12;
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
>>>>>>> Stashed changes

// Show registration form
router.get('/register', (req, res) => {
    res.render('register', { title: "Register" });
});

// Handle registration form submission
router.post('/register', async (req, res) => {
    try {
<<<<<<< Updated upstream
        await client.connect();
        const db = client.db(dbName);
        const usersCollection = db.collection('users');

        // Get form data
=======
        const { v4: uuidv4 } = await import('uuid');
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        const existingUser = await usersCollection.findOne({ email: req.body.email });
        if (existingUser) {
            return res.status(400).send("User already exists with this email.");
        }

        let pwdStrength = [];
        const userPassword = (req.body.password || '').toString().trim();
        const confirmPassword = (req.body.confirmPassword || '').toString().trim();

        if (userPassword.length < 8) { pwdStrength.push("Password length should be greater than 8.") }
        if (!/[A-Z]/.test(userPassword)) { pwdStrength.push("Password must contain at least one uppercase letter."); }
        if (!/[a-z]/.test(userPassword)) { pwdStrength.push("Password must contain at least one lowercase letter."); }
        if (!/[0-9]/.test(userPassword)) { pwdStrength.push("Password must contain at least one number."); }
        if (!/[!@#$%^&*()_\+\-=\[\]{};':\"\\|,.<>\/?`~]/.test(userPassword)) { pwdStrength.push("Password must contain at least one special character."); }
        if (userPassword !== confirmPassword) { pwdStrength.push("Passwords do not match."); }

        if (pwdStrength.length > 0) {
            return res.status(400).render('register', {
                title: "Register",
                errors: pwdStrength
            });
        }

        const hashedPassword = await bcrypt.hash(userPassword, saltRounds);
        const currentDate = new Date();
        const token = uuidv4();

>>>>>>> Stashed changes
        const newUser = {
            name: req.body.name,
            email: req.body.email,
<<<<<<< Updated upstream
            password: req.body.password 
        };

        // Insert new user into the database
        await usersCollection.insertOne(newUser);
        res.send("User registered successfully!");
=======
            passwordHash: hashedPassword,
            role: 'customer',
            accountStatus: 'active',
            isEmailVerified: false,
            verificationToken: token,
            tokenExpiry: new Date(Date.now() + 3600000),
            createdAt: currentDate,
            updatedAt: currentDate
        };

        await usersCollection.insertOne(newUser);
        
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const verificationUrl = `${baseUrl}/users/verify/${token}`;

        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: newUser.email,
            subject: 'Verify your account',
            html: `<h2>Welcome, ${newUser.firstName}!</h2><p>Thank you for registering. Please verify your email by clicking the link below:</p><a href="${verificationUrl}">${verificationUrl}</a>`
        });

        res.render('registration-success', { title: "Success!" });
>>>>>>> Stashed changes

    } catch (err) {
        console.error("Error saving user:", err);
        res.status(500).send("Something went wrong.");
    }
    // await client.close(); 
});

<<<<<<< Updated upstream
// --------------------------------------------------
// USER LISTING ROUTE
// --------------------------------------------------
=======
// Show login form
router.get('/login', (req, res) => {
    let message = '';
    if (req.query.status === 'loggedout') {
        message = 'You have been logged out.';
    }
    res.render('login', { 
        title: "Login",
        message: message
    });
});
>>>>>>> Stashed changes

// Show all registered users
router.get('/list', async (req, res) => {
    try {
        await client.connect();
        const db = client.db(dbName);
        const usersCollection = db.collection('users');

<<<<<<< Updated upstream
        const users = await usersCollection.find().toArray();
        res.render('users-list', { title: "Registered Users", users: users });

    } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).send("Something went wrong.");
    }
=======
        const user = await usersCollection.findOne({ email: req.body.email });
        if (!user) {
            return res.status(404).send("User not found.");
        }
        if (!user.isEmailVerified) {
            return res.send("Please verify your email before logging in.");
        }
        if (user.accountStatus !== 'active') {
            return res.status(403).send("Account is not active.");
        }

        const isPasswordValid = await bcrypt.compare(req.body.password, user.passwordHash);
        if (isPasswordValid) {
            req.session.user = {
                userId: user.userId,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role,
                isEmailVerified: user.isEmailVerified
            };
            // On successful login, redirect to the new account page
            res.redirect('/account');
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

// UPDATED: Old dashboard route now redirects to /account
router.get('/dashboard', (req, res) => {
    res.redirect('/account');
});

// UPDATED: Old admin route now redirects to the admin section of the account page
router.get('/admin', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Access denied. Admins only.");
    }
    // We'll build this route in account.js later
    res.redirect('/account/admin'); 
>>>>>>> Stashed changes
});

// --------------------------------------------------
// USER EDIT & UPDATE ROUTES
// --------------------------------------------------

// Show edit form for a specific user
router.get('/edit/:id', async (req, res) => {
    try {
        await client.connect();
        const db = client.db(dbName);
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ _id: new ObjectId(req.params.id) });

        if (!user) {
            return res.status(404).send("User not found.");
        }
<<<<<<< Updated upstream

        res.render('edit-user', { title: "Edit User", user: user });

    } catch (err) {
        console.error("Error loading user:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Handle update form submission
router.post('/edit/:id', async (req, res) => {
    try {
        await client.connect();
        const db = client.db(dbName);
        const usersCollection = db.collection('users');

        const updatedFields = {
            $set: {
                name: req.body.name,
                email: req.body.email
            }
        };

        await usersCollection.updateOne({ _id: new ObjectId(req.params.id) }, updatedFields);
        res.redirect('/users/list');

    } catch (err) {
        console.error("Error updating user:", err);
        res.status(500).send("Something went wrong.");
    }
});

//Handle Delete Data
router.post('/delete/:id', async (req, res) => {
    try {
        await client.connect();
        const db = client.db(dbName);
        const usersCollection = db.collection('users');
        
        await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.redirect('/users/list');
    } catch (err) {
        console.error("Error deleting user:", err);
        res.send("Something went wrong.");
    }
=======
        res.clearCookie('connect.sid');
        res.redirect('/users/login?status=loggedout');
    });
>>>>>>> Stashed changes
});

module.exports = router;