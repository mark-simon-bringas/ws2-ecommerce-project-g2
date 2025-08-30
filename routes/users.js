// routes/users.js
const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

// Show registration form
router.get('/register', (req, res) => {
    res.render('register', { title: "Register" });
});

// Handle registration form submission
router.post('/register', async (req, res) => {
    try {
        const usersCollection = req.db.collection('users');
        const newUser = {
            name: req.body.name,
            email: req.body.email,
            password: req.body.password // Note: In a real app, always hash passwords!
        };
        await usersCollection.insertOne(newUser);
        res.send("User registered successfully!");
    } catch (err) {
        console.error("Error saving user:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Show all registered users
router.get('/list', async (req, res) => {
    try {
        const usersCollection = req.db.collection('users');
        const users = await usersCollection.find().toArray();
        res.render('users-list', { title: "Registered Users", users: users });
    } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Show edit form for a specific user
router.get('/edit/:id', async (req, res) => {
    try {
        const usersCollection = req.db.collection('users');
        const user = await usersCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!user) {
            return res.status(404).send("User not found.");
        }
        res.render('edit-user', { title: "Edit User", user: user });
    } catch (err) {
        console.error("Error loading user:", err);
        res.status(500).send("Something went wrong.");
    }
});

// Handle update form submission
router.post('/edit/:id', async (req, res) => {
    try {
        const usersCollection = req.db.collection('users');
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
        const usersCollection = req.db.collection('users');
        await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.redirect('/users/list');
    } catch (err) {
        console.error("Error deleting user:", err);
        res.send("Something went wrong.");
    }
});

module.exports = router;