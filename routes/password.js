const express = require('express');
const router = express.Router();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const bcrypt = require('bcrypt');
const saltRounds = 12;

// Show forgot password form
router.get('/forgot', (req, res) => {
    res.render('forgot-password', { title: "Forgot Password" });
});

// Handle forgot password form submission
router.post('/forgot', async (req, res) => {
    try {
        const { v4: uuidv4 } = await import('uuid');
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        // Find user by email
        // Corrected 'users' to 'usersCollection' in the line below
        const user = await usersCollection.findOne({ email: req.body.email });
        if (user) {
            // Generate reset token and expiry (1 hour)
            const token = uuidv4();
            const expiry = new Date(Date.now() + 3600000); // 1 hour from now

            // Save token and expiry in the user's document
            await usersCollection.updateOne(
                { email: user.email },
                { $set: { resetToken: token, resetExpiry: expiry } }
            );

            // Build reset URL
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const resetUrl = `${baseUrl}/password/reset/${token}`;

            // Send email with Resend
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
        
        // Always send a generic success message to prevent email enumeration
        res.send("If an account with that email exists, a password reset link has been sent to it.");

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

        // Find user by token and make sure it's not expired
        const user = await usersCollection.findOne({
            resetToken: req.params.token,
            resetExpiry: { $gt: new Date() } // Check if expiry date is greater than now
        });

        if (!user) {
            return res.send("Password reset link is invalid or has expired.");
        }

        res.render('reset-password', { 
            title: "Reset Password", 
            token: req.params.token 
        });

    } catch (err) {
        console.error("Error showing reset form:", err);
        res.status(500).send("Something went wrong.");
    }
});


// Handle reset password form submission
router.post('/reset/:token', async (req, res) => {
    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const usersCollection = db.collection('users');

        // Find user by token and ensure it's not expired
        const user = await usersCollection.findOne({
            resetToken: req.params.token,
            resetExpiry: { $gt: new Date() }
        });

        if (!user) {
            return res.send("Password reset link is invalid or has expired.");
        }

        // Check if passwords match
        if (req.body.password !== req.body.confirm) {
            return res.send("Passwords do not match.");
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);

        // Update password in DB and clear the reset token fields
        await usersCollection.updateOne(
            { email: user.email },
            {
                $set: { passwordHash: hashedPassword, updatedAt: new Date() },
                $unset: { resetToken: "", resetExpiry: "" }
            }
        );

        res.send("Your password has been reset successfully. You can now log in with your new password.");

    } catch (err) {
        console.error("Error resetting password:", err);
        res.status(500).send("Something went wrong.");
    }
});

// This line is CRUCIAL for the routes to work.
module.exports = router;