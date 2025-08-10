const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Path to the file where email addresses will be stored
const subscribersFilePath = path.join(__dirname, 'subscribers.txt');

// Middleware to ensure authentication
function isAuthenticated(_req, _res, next) {
    // Your authentication logic here
    next();
}

// Route to subscribe to the newsletter
router.post('/subscribe', isAuthenticated, (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).send('Email is required');
    }

    // Check if email is already subscribed
    let subscribers = [];
    if (fs.existsSync(subscribersFilePath)) {
        subscribers = fs.readFileSync(subscribersFilePath, 'utf-8').split('\n').filter(Boolean);
    }
    if (subscribers.includes(email)) {
        return res.status(400).send('Email is already subscribed');
    }

    // Append email to the file
    try {
        fs.appendFileSync(subscribersFilePath, email + '\n');
        res.send('Subscribed successfully');
    } catch (err) {
        console.error('Error appending to subscribers file:', err); // Log the error
        res.status(500).send('Failed to subscribe');
    }
});

module.exports = router;