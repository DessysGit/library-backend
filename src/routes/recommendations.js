const express = require('express');
const router = express.Router();
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const { isAuthenticated } = require('../middleware/auth');

// Get book recommendations for user
router.get('/', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const currentBookId = req.query.bookId;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  // Get user's liked books for "why recommended" logic
  const { pool } = require('../config/database');
  let userLikes = [];
  try {
    const userLikesResult = await pool.query(
      `SELECT b.id, b.title, b.author, b.genres 
       FROM books b
       INNER JOIN book_likes bl ON b.id = bl.book_id
       WHERE bl.user_id = $1 AND bl.liked = true`,
      [userId]
    );
    userLikes = userLikesResult.rows;
  } catch (err) {
    console.error('Error fetching user likes:', err);
  }

  // Try external Flask service first
  try {
    const response = await axios.get(`http://127.0.0.1:5000/recommendations?user_id=${encodeURIComponent(userId)}`);
    if (response.data && response.data.recommendations) {
      const filteredRecommendations = response.data.recommendations
        .filter((book) => book.id !== parseInt(currentBookId))
        .slice(0, 4);
      return res.json({ 
        recommendations: filteredRecommendations,
        userLikes: userLikes
      });
    }
  } catch (error) {
    console.error("Flask service not available:", error.message);

    // Run Python script directly
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const python = spawn(pythonCmd, [
      path.join(__dirname, '../../recommend.py'),
      '--user_id', userId.toString()
    ]);

    let output = '';
    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      console.error('recommend.py error:', data.toString());
    });

    python.on('close', async (code) => {
      try {
        const result = JSON.parse(output);
        const filteredRecommendations = result.recommendations
          .filter((book) => book.id !== parseInt(currentBookId))
          .slice(0, 4);
        res.json({ 
          recommendations: filteredRecommendations,
          userLikes: userLikes
        });
      } catch (err) {
        console.error('Error parsing recommend.py output:', err);

        // Fallback: query database directly
        try {
          const fallback = await pool.query(
            'SELECT id, title, description, cover FROM books WHERE id != $1 LIMIT 4',
            [currentBookId]
          );
          res.json({ 
            recommendations: fallback.rows,
            userLikes: userLikes
          });
        } catch (dbErr) {
          console.error("Error fetching fallback recommendations:", dbErr.message);
          res.status(500).json({ error: "Error fetching recommendations" });
        }
      }
    });
  }
});

module.exports = router;
