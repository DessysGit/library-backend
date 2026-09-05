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
       INNER JOIN likes bl ON b.id = bl."bookId"
       WHERE bl."userId" = $1 AND bl.action = 'like'`,
      [userId]
    );
    userLikes = userLikesResult.rows;
  } catch (err) {
    console.error('Error fetching user likes:', err);
  }

  // Try external Flask service first
  try {
    // Hard timeout so a half-open connection can never hang the request
    const response = await axios.get(
      `http://127.0.0.1:5000/recommendations?user_id=${encodeURIComponent(userId)}`,
      { timeout: 2000 }
    );
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

    // Run Python script directly (with a safety net — see below)
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const python = spawn(pythonCmd, [
      path.join(__dirname, '../../recommend.py'),
      '--user_id', userId.toString()
    ]);

    let output = '';
    let settled = false; // guard so we respond exactly once

    const sendFallback = async () => {
      if (settled) return;
      settled = true;
      try {
        // Fallback: query database directly
        const fallback = await pool.query(
          `SELECT b.id, b.title, b.author, b.description, b.cover, b.genres,
                  COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 1)
                            FROM reviews r WHERE r.bookid = b.id), 0) AS avg_rating
           FROM books b
           WHERE b.id != $1
           ORDER BY b.id DESC
           LIMIT 12`,
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
        if (!res.headersSent) {
          res.status(500).json({ error: "Error fetching recommendations" });
        }
      }
    };

    // If the interpreter is missing (e.g. ENOENT on Render), 'close' never
    // fires — handle 'error' or the request would hang forever.
    python.on('error', async (err) => {
      console.error('Failed to start recommend.py:', err.message);
      await sendFallback();
    });

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      console.error('recommend.py error:', data.toString());
    });

    // Safety net: if the script hasn't finished within 5s, kill it and fall back
    const killTimer = setTimeout(async () => {
      if (!settled) {
        console.error('recommend.py timed out after 5s — using DB fallback');
        python.kill();
        await sendFallback();
      }
    }, 5000);

    python.on('close', async (code) => {
      if (settled) return;
      clearTimeout(killTimer);
      settled = true;
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
        // Fall back to DB query directly
        await sendFallback();
      }
    });
  }
});

module.exports = router;
