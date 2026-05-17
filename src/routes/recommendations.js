const express = require('express');
const router = express.Router();
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const { isAuthenticated } = require('../middleware/auth');

// ===== CACHING SYSTEM =====
// Simple in-memory cache to speed up recommendations
const recommendationCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

function getCacheKey(userId, bookId) {
  return `${userId}_${bookId || 'general'}`;
}

function getCachedRecommendations(userId, bookId) {
  const key = getCacheKey(userId, bookId);
  const cached = recommendationCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`✅ Cache HIT for ${key}`);
    return cached.data;
  }
  
  console.log(`❌ Cache MISS for ${key}`);
  return null;
}

function setCachedRecommendations(userId, bookId, data) {
  const key = getCacheKey(userId, bookId);
  recommendationCache.set(key, {
    data: data,
    timestamp: Date.now()
  });
  
  // Limit cache size to 100 entries (prevent memory bloat)
  if (recommendationCache.size > 100) {
    const firstKey = recommendationCache.keys().next().value;
    recommendationCache.delete(firstKey);
  }
  
  console.log(`💾 Cached recommendations for ${key}`);
}
// ===== END CACHING SYSTEM =====

// Get book recommendations for user
router.get('/', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const currentBookId = req.query.bookId;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  // ===== CHECK CACHE FIRST =====
  const cachedResult = getCachedRecommendations(userId, currentBookId);
  if (cachedResult) {
    return res.json(cachedResult); // Return cached data immediately
  }
  // ===== END CACHE CHECK =====

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
        .slice(0, 12);
      
      const result = {
        recommendations: filteredRecommendations,
        userLikes: userLikes
      };
      
      // Cache the result
      setCachedRecommendations(userId, currentBookId, result);
      
      return res.json(result);
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
          .slice(0, 12);
        
        const responseData = {
          recommendations: filteredRecommendations,
          userLikes: userLikes
        };
        
        // Cache the result
        setCachedRecommendations(userId, currentBookId, responseData);
        
        res.json(responseData);
      } catch (err) {
        console.error('Error parsing recommend.py output:', err);

        // Fallback: query database directly
        try {
          const fallback = await pool.query(
            'SELECT id, title, description, cover FROM books WHERE id != $1 LIMIT 12',
            [currentBookId]
          );
          
          const fallbackData = {
            recommendations: fallback.rows,
            userLikes: userLikes
          };
          
          // Cache even fallback results
          setCachedRecommendations(userId, currentBookId, fallbackData);
          
          res.json(fallbackData);
        } catch (dbErr) {
          console.error("Error fetching fallback recommendations:", dbErr.message);
          res.status(500).json({ error: "Error fetching recommendations" });
        }
      }
    });
  }
});

module.exports = router;
