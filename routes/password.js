const express = require('express');
const verifyTurnstile = require('../utils/turnstileVerify');
const router = express.Router();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const bcrypt = require('bcrypt');
const saltRounds = 12;

// Show forgot password form
router.get('/forgot', (req, res) => {
    res.render('forgot-password', { 
        title: "Forgot Password",
        page: 'auth'
    });
});

// Handle forgot password form submission
// --- Updated ---
router.post('/forgot', async (req, res) => {
    try {
        const { v4: uuidv4 } = await import('uuid');
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ email: req.body.email });
        if (user) {
            const token = uuidv4();
            const expiry = new Date(Date.now() + 3600000); // 1 hour from now

            await usersCollection.updateOne(
                { email: user.email },
                { $set: { resetToken: token, resetExpiry: expiry } }
            );

            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const resetUrl = `${baseUrl}/password/reset/${token}`;

            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL,
                to: user.email,
                subject: 'Password Reset Request',
                html: `
                    <h2>Password Reset</h2>
                    <p>You requested a password reset. Click the link below to create a new password:</p>
                    <a href="${resetUrl}">${resetUrl}</a>
                    <p>This link will expire in one hour.</p>
                `
            });
        }
        
        // Instead of res.send, render the new confirmation page
        res.render('reset-request-sent', {
            title: 'Check Your Email',
            page: 'auth'
        });

    } catch (err) {
        console.error("Error in password reset:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Show reset password form
router.get('/reset/:token', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({
            resetToken: req.params.token,
            resetExpiry: { $gt: new Date() }
        });

        if (!user) {
            return res.send("Password reset link is invalid or has expired.");
        }

        res.render('reset-password', { 
            title: "Reset Password", 
            token: req.params.token,
            turnstileSiteKey: process.env.TURNSTILE_SITEKEY,
            page: 'auth'
        });

    } catch (err) {
        console.error("Error showing reset form:", err);
        res.status(500).send("Something went wrong.");
    }
});


// Handle reset password form submission
// --- Updated ---
router.post('/reset/:token', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        const token = req.body['cf-turnstile-response'];
        const ip = req.ip;
        const result = await verifyTurnstile(token, ip);

        const user = await usersCollection.findOne({
            resetToken: req.params.token,
            resetExpiry: { $gt: new Date() }
        });

        if (!result.success) {
         return res.render('reset-password', {
            title: 'Reset Password',
            token: req.params.token,
            error: 'Human verification failed. Please try again.',
            turnstileSiteKey: process.env.TURNSTILE_SITEKEY
            });
        }

        if (!user) {
            return res.send("Password reset link is invalid or has expired.");
        }

        if (req.body.password !== req.body.confirm) {
            return res.render('reset-password', {
                title: "Reset Password",
                token: req.params.token,
                page: 'auth',
                error: 'Passwords do not match.'
            });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);

        await usersCollection.updateOne(
            { email: user.email },
            {
                $set: { passwordHash: hashedPassword, updatedAt: new Date() },
                $unset: { resetToken: "", resetExpiry: "" }
            }
        );

        // Instead of res.send, render the new success page
        res.render('password-reset-success', {
            title: 'Password Reset',
            page: 'auth'
        });

    } catch (err) {
        console.error("Error resetting password:", err);
        res.status(500).send("Something went wrong.");
    }
});

module.exports = router;