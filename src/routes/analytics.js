/**
 * Admin Analytics Routes
 * 
 * Provides statistics and analytics for admin dashboard
 * Uses public.users explicitly to avoid schema conflicts
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Get overall statistics
router.get('/stats', isAdmin, async (req, res) => {
  try {
    // Total counts
    const [users, books, reviews] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM public.users'),
      pool.query('SELECT COUNT(*) as count FROM books'),
      pool.query('SELECT COUNT(*) as count FROM reviews')
    ]);

    // Recent registrations (last 30 days)
    let recentUsers = { rows: [{ count: 0 }] };
    try {
      recentUsers = await pool.query(`
        SELECT COUNT(*) as count 
        FROM public.users 
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `);
    } catch (err) {
      console.log('Note: Could not fetch recent users count');
    }

    // Average rating
    const avgRating = await pool.query(`
      SELECT COALESCE(AVG(rating)::numeric(10,2), 0) as avg 
      FROM reviews
    `);

    res.json({
      totalUsers: parseInt(users.rows[0].count),
      totalBooks: parseInt(books.rows[0].count),
      totalReviews: parseInt(reviews.rows[0].count),
      totalDownloads: 0, // Placeholder - to be implemented
      recentUsers: parseInt(recentUsers.rows[0].count),
      recentBooks: 0, // Books table doesn't have timestamp
      averageRating: parseFloat(avgRating.rows[0].avg) || 0
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics', details: error.message });
  }
});

// Get popular books (most reviewed/highest rated)
router.get('/popular-books', isAdmin, async (req, res) => {
  try {
    const popularBooks = await pool.query(`
      SELECT 
        b.id,
        b.title,
        b.author,
        b.cover,
        COUNT(r.id) as review_count,
        COALESCE(AVG(r.rating)::numeric(10,2), 0) as avg_rating,
        COALESCE(b.likes, 0) as likes,
        COALESCE(b.dislikes, 0) as dislikes
      FROM books b
      LEFT JOIN reviews r ON b.id = r.bookid
      GROUP BY b.id, b.title, b.author, b.cover, b.likes, b.dislikes
      ORDER BY review_count DESC, avg_rating DESC
      LIMIT 10
    `);

    res.json(popularBooks.rows.map(book => ({
      id: book.id,
      title: book.title,
      author: book.author,
      cover: book.cover,
      reviewCount: parseInt(book.review_count),
      avgRating: parseFloat(book.avg_rating),
      likes: parseInt(book.likes) || 0,
      dislikes: parseInt(book.dislikes) || 0
    })));
  } catch (error) {
    console.error('Error fetching popular books:', error);
    res.status(500).json({ error: 'Failed to fetch popular books', details: error.message });
  }
});

// Get genre distribution
router.get('/genre-stats', isAdmin, async (req, res) => {
  try {
    const genreStats = await pool.query(`
      SELECT 
        TRIM(UNNEST(string_to_array(genres, ','))) as genre,
        COUNT(*) as count
      FROM books
      WHERE genres IS NOT NULL AND genres != ''
      GROUP BY genre
      ORDER BY count DESC
      LIMIT 10
    `);

    res.json(genreStats.rows.map(row => ({
      genre: row.genre,
      count: parseInt(row.count)
    })));
  } catch (error) {
    console.error('Error fetching genre stats:', error);
    res.status(500).json({ error: 'Failed to fetch genre statistics', details: error.message });
  }
});

// Get user activity (registrations over time)
router.get('/user-activity', isAdmin, async (req, res) => {
  try {
    const activity = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM public.users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    res.json(activity.rows.map(row => ({
      date: row.date,
      count: parseInt(row.count)
    })));
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.json([]);
  }
});

// Get recent activity feed
router.get('/recent-activity', isAdmin, async (req, res) => {
  try {
    // Get recent reviews (using id as proxy for time since no timestamp)
    const recentReviews = await pool.query(`
      SELECT 
        r.id,
        r.rating,
        r.text as comment,
        r.username,
        b.title as book_title,
        'review' as type
      FROM reviews r
      JOIN books b ON r.bookid = b.id
      ORDER BY r.id DESC
      LIMIT 5
    `);

    // Get recent users
    let recentUsers = { rows: [] };
    try {
      recentUsers = await pool.query(`
        SELECT 
          id,
          username,
          email,
          created_at,
          'user' as type
        FROM public.users
        ORDER BY created_at DESC
        LIMIT 5
      `);
    } catch (err) {
      console.log('Note: Could not fetch recent users');
    }

    // Combine activities
    const allActivity = [
      ...recentReviews.rows.map(r => ({
        ...r,
        createdAt: new Date() // Reviews don't have timestamps yet
      })),
      ...recentUsers.rows.map(u => ({
        ...u,
        createdAt: u.created_at || new Date()
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);

    res.json(allActivity);
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity', details: error.message });
  }
});

// Get top reviewers
router.get('/top-reviewers', isAdmin, async (req, res) => {
  try {
    const topReviewers = await pool.query(`
      SELECT 
        u.id,
        u.username,
        u.email,
        COUNT(r.id) as review_count,
        COALESCE(AVG(r.rating)::numeric(10,2), 0) as avg_rating
      FROM public.users u
      JOIN reviews r ON u.id = r.userid
      GROUP BY u.id, u.username, u.email
      ORDER BY review_count DESC
      LIMIT 10
    `);

    res.json(topReviewers.rows.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      reviewCount: parseInt(user.review_count),
      avgRating: parseFloat(user.avg_rating)
    })));
  } catch (error) {
    console.error('Error fetching top reviewers:', error);
    res.status(500).json({ error: 'Failed to fetch top reviewers', details: error.message });
  }
});

// Get books without reviews (need attention)
router.get('/books-without-reviews', isAdmin, async (req, res) => {
  try {
    const booksWithoutReviews = await pool.query(`
      SELECT 
        b.id,
        b.title,
        b.author,
        b.cover
      FROM books b
      LEFT JOIN reviews r ON b.id = r.bookid
      WHERE r.id IS NULL
      ORDER BY b.id DESC
      LIMIT 10
    `);

    res.json(booksWithoutReviews.rows.map(book => ({
      id: book.id,
      title: book.title,
      author: book.author,
      cover: book.cover,
      createdAt: null // No timestamp available
    })));
  } catch (error) {
    console.error('Error fetching books without reviews:', error);
    res.status(500).json({ error: 'Failed to fetch books without reviews', details: error.message });
  }
});

module.exports = router;
