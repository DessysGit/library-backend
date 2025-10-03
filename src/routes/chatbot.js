const express = require('express');
const router = express.Router();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

// Chat with AI
router.post('/chat', async (req, res) => {
  const userMessage = req.body.message;
  // Optionally get username from session if available
  const username = req.user?.username || 'User';

  try {
    const response = await fetch('https://api-inference.huggingface.co/models/facebook/blenderbot-400M-distill', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      // Optionally prepend username for context
      body: JSON.stringify({ inputs: `${username}: ${userMessage}` })
    });

    if (!response.ok) {
      console.error('LibBot API error:', response.status, response.statusText);
      return res.status(response.status).json({ reply: 'Oops! Something went wrong with LibBot.' });
    }

    const data = await response.json();
    console.log('LibBot API response:', data);

    const reply = data?.[0]?.generated_text || 'Sorry, I didn\'t understand that.';
    res.json({ reply });
  } catch (error) {
    console.error('LibBot API error:', error.message);
    res.status(500).json({ reply: 'Oops! Something went wrong with LibBot.' });
  }
});

module.exports = router;
