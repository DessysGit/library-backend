const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { isAuthenticated } = require('../middleware/auth');

const subscribersFilePath = path.join(__dirname, '../../subscribers.txt');

// Newsletter subscription
router.post('/subscribe', isAuthenticated, (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).send('Email is required');
  }

  let subscribers = [];
  if (fs.existsSync(subscribersFilePath)) {
    subscribers = fs.readFileSync(subscribersFilePath, 'utf-8').split('\n').filter(Boolean);
  }

  if (subscribers.includes(email)) {
    return res.status(400).send('Email is already subscribed');
  }

  fs.appendFileSync(subscribersFilePath, email + '\n');
  res.send('Subscribed successfully');
});

module.exports = router;
