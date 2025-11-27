const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

// Get reviews for a book
router.get('/:bookId/reviews', async (req, res) => {
  const bookId = req.params.bookId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT 
        r.username, 
        r.text, 
        r.rating,
        COALESCE(u.profilepicture, '') as profilepicture
       FROM reviews r
       LEFT JOIN users u ON r.userid = u.id 
       WHERE r.bookid = $1 
       ORDER BY r.id DESC
       LIMIT $2 OFFSET $3`,
      [bookId, limit, offset]
    );
    // Ensure profilepicture is always a string
    const reviews = result.rows.map(row => ({
      ...row,
      profilepicture: row.profilepicture || ''
    }));
    res.json(reviews);
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ error: 'Failed to fetch reviews', details: err.message });
  }
});

// Submit a review
router.post('/:bookId/reviews', isAuthenticated, async (req, res) => {
  const { text, rating } = req.body;
  const bookId = req.params.bookId;
  const userId = req.user.id;
  const username = req.user.username;

  if (!text || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Invalid review data' });
  }

  try {
    await pool.query(
      'INSERT INTO reviews (bookid, userid, username, text, rating) VALUES ($1, $2, $3, $4, $5)',
      [bookId, userId, username, text, rating]
    );

    // Update average rating
    const ratingResult = await pool.query(
      'SELECT AVG(rating) AS avg_rating FROM reviews WHERE bookid = $1', 
      [bookId]
    );
    const averageRating = parseFloat(ratingResult.rows[0]?.avg_rating) || 0;

    await pool.query(
      'UPDATE books SET averagerating = $1 WHERE id = $2', 
      [averageRating, bookId]
    );

    res.status(201).json({ 
      message: 'Review added successfully', 
      averageRating: averageRating 
    });

  } catch (err) {
    console.error('Error submitting review:', err);
    res.status(500).json({ error: 'Failed to submit review', details: err.message });
  }
});

module.exports = router;
