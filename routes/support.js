// routes/support.js

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { Resend } = require('resend');
const { convertCurrency } = require('./currency'); // Import the converter

const resend = new Resend(process.env.RESEND_API_KEY);

// Define shipping constants (using USD as the base currency)
const SHIPPING_COST_BASE = 5;
const FREE_SHIPPING_THRESHOLD_BASE = 150;

// Helper to generate a short, user-friendly ticket ID
function generateTicketId() {
    return Math.random().toString(36).substring(2, 9).toUpperCase();
}

// GET /support - Main support landing page
router.get('/', (req, res) => {
    res.render('support/index', {
        title: 'Support Center'
    });
});

// GET /support/contact - Shows the form to create a new ticket or find an existing one
router.get('/contact', (req, res) => {
    res.render('support/contact', {
        title: 'Contact Us',
        error: req.query.error,
        success: req.query.success
    });
});

// POST /support/contact - Handles submission of a NEW support ticket
router.post('/contact', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('support_tickets');
        const ticketId = generateTicketId();

        const newTicket = {
            ticketId: ticketId,
            userEmail: email.toLowerCase(),
            userId: req.session.user ? req.session.user.userId : null,
            subject: subject,
            status: 'Open',
            createdAt: new Date(),
            updatedAt: new Date(),
            messages: [{
                sender: 'user',
                name: name,
                message: message,
                timestamp: new Date()
            }]
        };

        await ticketsCollection.insertOne(newTicket);
        
        await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: 'admin@sneakslab.shop', // Replace with your actual support email
            subject: `New Support Ticket [${ticketId}]: ${subject}`,
            html: `<p>A new support ticket has been created by ${name} (${email}).</p><p><strong>Message:</strong></p><p>${message}</p>`
        });


        res.render('support/ticket-success', {
            title: 'Ticket Submitted',
            ticketId: ticketId,
            email: email
        });

    } catch (err) {
        console.error("Error creating support ticket:", err);
        res.redirect('/support/contact?error=' + encodeURIComponent('Failed to create ticket. Please try again.'));
    }
});

// POST /support/tickets/find - Handles lookup of an existing ticket
router.post('/tickets/find', async (req, res) => {
    const { ticketId, email } = req.body;
    if (!ticketId || !email) {
        return res.redirect('/support/contact?error=' + encodeURIComponent('Both Ticket ID and Email are required.'));
    }
    res.redirect(`/support/tickets/${ticketId}?email=${encodeURIComponent(email)}`);
});


// GET /support/tickets/:ticketId - Displays a specific ticket conversation
router.get('/tickets/:ticketId', async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { email } = req.query;
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('support_tickets');

        const ticket = await ticketsCollection.findOne({ 
            ticketId: ticketId.toUpperCase(),
            userEmail: email.toLowerCase() 
        });

        if (!ticket) {
            return res.redirect('/support/contact?error=' + encodeURIComponent('Ticket not found. Please check your ID and email.'));
        }

        res.render('support/ticket-detail', {
            title: `Ticket #${ticket.ticketId}`,
            ticket: ticket,
            error: req.query.error,
            success: req.query.success
        });
    } catch (err) {
        console.error("Error finding ticket:", err);
        res.redirect('/support/contact?error=' + encodeURIComponent('An error occurred while finding your ticket.'));
    }
});

// POST /support/tickets/:ticketId/reply - Handles a new message from the user on an existing ticket
router.post('/tickets/:ticketId/reply', async (req, res) => {
    const { ticketId } = req.params;
    const { message, userEmail } = req.body;

    try {
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ticketsCollection = db.collection('support_tickets');
        
        const ticket = await ticketsCollection.findOne({ ticketId: ticketId.toUpperCase() });
        if (!ticket) {
            return res.status(404).send('Ticket not found.');
        }

        const newMessage = {
            sender: 'user',
            name: ticket.messages[0].name,
            message: message,
            timestamp: new Date()
        };

        await ticketsCollection.updateOne(
            { _id: ticket._id },
            { 
                $push: { messages: newMessage },
                $set: { status: 'Open', updatedAt: new Date() }
            }
        );

        res.redirect(`/support/tickets/${ticketId}?email=${encodeURIComponent(userEmail)}&success=` + encodeURIComponent('Your reply has been sent!'));

    } catch (err) {
        console.error("Error replying to ticket:", err);
        res.redirect(`/support/tickets/${ticketId}?email=${encodeURIComponent(userEmail)}&error=` + encodeURIComponent('Failed to send reply.'));
    }
});


// GET /support/order-status - Shows the initial lookup form
router.get('/order-status', (req, res) => {
    res.render('support/order-status', {
        title: 'Order Status',
        order: null,
        error: null,
        page: 'auth'
    });
});

// POST /support/order-status - Handles the form submission and displays results
router.post('/order-status', async (req, res) => {
    try {
        const { orderId, email } = req.body;
        
        if (!orderId || !email) {
            return res.render('support/order-status', { title: 'Order Status', order: null, error: 'Please enter both an Order ID and an email address.', page: 'auth' });
        }
        
        const db = req.app.locals.client.db(req.app.locals.dbName);
        const ordersCollection = db.collection('orders');
        const currency = res.locals.locationData.currency;

        const userOrders = await ordersCollection.find({ "customer.email": new RegExp(`^${email}$`, 'i') }).toArray();
        const foundOrder = userOrders.find(order => order._id.toString().toLowerCase().endsWith(orderId.toLowerCase()));

        if (!foundOrder) {
            return res.render('support/order-status', { title: 'Order Status', order: null, error: 'No order found with that ID and email address. Please check your details and try again.', page: 'auth' });
        }
        
        foundOrder.subtotal = await convertCurrency(foundOrder.subtotal, currency);
        foundOrder.shippingCost = await convertCurrency(foundOrder.shippingCost, currency);
        foundOrder.total = await convertCurrency(foundOrder.total, currency);
        foundOrder.items = await Promise.all(foundOrder.items.map(async (item) => {
            item.price = await convertCurrency(item.price, currency);
            return item;
        }));
        
        res.render('support/order-status', {
            title: `Status for Order #${orderId.toUpperCase()}`,
            order: foundOrder,
            error: null,
            pageStyle: 'order-success'
        });

    } catch (err) {
        console.error("Error looking up order status:", err);
        res.render('support/order-status', { title: 'Order Status', order: null, error: 'An unexpected error occurred. Please try again later.', page: 'auth' });
    }
});


// GET /support/shipping - Shipping & Delivery info page
router.get('/shipping', async (req, res) => {
    const currency = res.locals.locationData.currency;
    const shippingCost = await convertCurrency(SHIPPING_COST_BASE, currency);
    const freeShippingThreshold = await convertCurrency(FREE_SHIPPING_THRESHOLD_BASE, currency);

    res.render('support/shipping', {
        title: 'Shipping & Delivery',
        shippingCost: shippingCost,
        freeShippingThreshold: freeShippingThreshold
    });
});

// GET /support/returns - Returns info page
router.get('/returns', (req, res) => {
    res.render('support/returns', {
        title: 'Returns'
    });
});

module.exports = router;