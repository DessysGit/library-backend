/**
 * Enhanced Admin Analytics Routes
 * 
 * Provides comprehensive statistics and analytics for admin dashboard
 * Includes time filtering and advanced metrics
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

/**
 * Helper function to get time filter condition
 */
function getTimeFilterCondition(timeFilter, columnName = 'created_at') {
  switch(timeFilter) {
    case '1':
      return `${columnName} >= CURRENT_DATE`;
    case '7':
      return `${columnName} >= NOW() - INTERVAL '7 days'`;
    case '30':
      return `${columnName} >= NOW() - INTERVAL '30 days'`;
    case 'all':
    default:
      return '1=1'; // Always true - no filter
  }
}

// Get overall statistics with time filter
router.get('/stats', isAdmin, async (req, res) => {
  try {
    const { timeFilter = 'all' } = req.query;

    // Total counts
    const [users, books, reviews] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM public.users'),
      pool.query('SELECT COUNT(*) as count FROM books'),
      pool.query('SELECT COUNT(*) as count FROM reviews')
    ]);

    // Recent registrations (last 30 days)
    const recentUsers = await pool.query(`
      SELECT COUNT(*) as count 
      FROM public.users 
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    // Recent books (last 30 days)
    const recentBooks = await pool.query(`
      SELECT COUNT(*) as count 
      FROM books 
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);

    // Average rating
    const avgRating = await pool.query(`
      SELECT COALESCE(AVG(rating)::numeric(10,2), 0) as avg 
      FROM reviews
    `);

    // Active users (users who reviewed in last 7 days)
    const activeUsers = await pool.query(`
      SELECT COUNT(DISTINCT userid) as count 
      FROM reviews
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);

    res.json({
      totalUsers: parseInt(users.rows[0].count),
      totalBooks: parseInt(books.rows[0].count),
      totalReviews: parseInt(reviews.rows[0].count),
      recentUsers: parseInt(recentUsers.rows[0].count),
      recentBooks: parseInt(recentBooks.rows[0].count),
      averageRating: parseFloat(avgRating.rows[0].avg) || 0,
      activeUsers: parseInt(activeUsers.rows[0].count)
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
      HAVING COUNT(r.id) > 0
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
      LIMIT 12
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

// Get user activity (registrations over time) with time filter
router.get('/user-activity', isAdmin, async (req, res) => {
  try {
    const { timeFilter = '30' } = req.query;
    let interval = '30 days';
    
    switch(timeFilter) {
      case '1':
        interval = '1 day';
        break;
      case '7':
        interval = '7 days';
        break;
      case '30':
        interval = '30 days';
        break;
      case 'all':
        interval = '1 year';
        break;
    }

    const activity = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM public.users
      WHERE created_at >= NOW() - INTERVAL '${interval}'
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

// Get book uploads over time (REAL DATA using created_at)
router.get('/book-uploads', isAdmin, async (req, res) => {
  try {
    const { timeFilter = '30' } = req.query;
    let interval = '30 days';
    
    switch(timeFilter) {
      case '1':
        interval = '1 day';
        break;
      case '7':
        interval = '7 days';
        break;
      case '30':
        interval = '30 days';
        break;
      case 'all':
        interval = '1 year';
        break;
    }

    const bookUploads = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM books
      WHERE created_at >= NOW() - INTERVAL '${interval}'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    res.json(bookUploads.rows.map(row => ({
      date: row.date,
      count: parseInt(row.count)
    })));
  } catch (error) {
    console.error('Error fetching book uploads:', error);
    res.json([]);
  }
});

// Get rating distribution (1-5 stars)
router.get('/rating-distribution', isAdmin, async (req, res) => {
  try {
    const distribution = await pool.query(`
      SELECT 
        rating,
        COUNT(*) as count
      FROM reviews
      GROUP BY rating
      ORDER BY rating ASC
    `);

    res.json(distribution.rows.map(row => ({
      rating: parseInt(row.rating),
      count: parseInt(row.count)
    })));
  } catch (error) {
    console.error('Error fetching rating distribution:', error);
    res.json([]);
  }
});

// Get review trends over time (REAL DATA using created_at)
router.get('/review-trends', isAdmin, async (req, res) => {
  try {
    const { timeFilter = '30' } = req.query;
    let interval = '30 days';
    
    switch(timeFilter) {
      case '1':
        interval = '1 day';
        break;
      case '7':
        interval = '7 days';
        break;
      case '30':
        interval = '30 days';
        break;
      case 'all':
        interval = '1 year';
        break;
    }

    const reviewTrends = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM reviews
      WHERE created_at >= NOW() - INTERVAL '${interval}'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    res.json(reviewTrends.rows.map(row => ({
      date: row.date,
      count: parseInt(row.count)
    })));
  } catch (error) {
    console.error('Error fetching review trends:', error);
    res.json([]);
  }
});

// Get recent activity feed (REAL DATA using created_at)
router.get('/recent-activity', isAdmin, async (req, res) => {
  try {
    // Get recent reviews
    const recentReviews = await pool.query(`
      SELECT 
        r.id,
        r.rating,
        r.text as comment,
        r.username,
        r.created_at,
        b.title as book_title,
        'review' as type
      FROM reviews r
      JOIN books b ON r.bookid = b.id
      ORDER BY r.created_at DESC
      LIMIT 8
    `);

    // Get recent users
    const recentUsers = await pool.query(`
      SELECT 
        id,
        username,
        email,
        created_at,
        'user' as type
      FROM public.users
      ORDER BY created_at DESC
      LIMIT 8
    `);

    // Get recent books
    const recentBooks = await pool.query(`
      SELECT 
        id,
        title,
        author,
        created_at,
        'book' as type
      FROM books
      ORDER BY created_at DESC
      LIMIT 8
    `);

    // Combine activities
    const allActivity = [
      ...recentReviews.rows.map(r => ({
        type: 'review',
        username: r.username,
        book_title: r.book_title,
        rating: r.rating,
        createdAt: r.created_at
      })),
      ...recentUsers.rows.map(u => ({
        type: 'user',
        username: u.username,
        createdAt: u.created_at
      })),
      ...recentBooks.rows.map(b => ({
        type: 'book',
        title: b.title,
        author: b.author,
        createdAt: b.created_at
      }))
    ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 15);

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
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) as avg_rating
      FROM public.users u
      JOIN reviews r ON u.id = r.userid
      GROUP BY u.id, u.username, u.email
      HAVING COUNT(r.id) > 0
      ORDER BY review_count DESC, avg_rating DESC
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
        b.cover,
        b.created_at
      FROM books b
      LEFT JOIN reviews r ON b.id = r.bookid
      WHERE r.id IS NULL
      ORDER BY b.created_at DESC
      LIMIT 20
    `);

    res.json(booksWithoutReviews.rows.map(book => ({
      id: book.id,
      title: book.title,
      author: book.author,
      cover: book.cover,
      createdAt: book.created_at
    })));
  } catch (error) {
    console.error('Error fetching books without reviews:', error);
    res.status(500).json({ error: 'Failed to fetch books without reviews', details: error.message });
  }
});

module.exports = router;
