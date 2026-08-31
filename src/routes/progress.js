const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

// Get reading progress for a book (logged-in users only)
router.get('/:bookId', isAuthenticated, async (req, res) => {
    const bookId = req.params.bookId;
    const userId = req.user.id;

    try {
        const result = await pool.query(
            'SELECT "lastPage", "totalPages", "updatedAt" FROM reading_progress WHERE "userId" = $1 AND "bookId" = $2',
            [userId, bookId]
        );

        if (result.rows.length === 0) {
            return res.json(null);
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching reading progress:', err);
        res.status(500).json({ error: 'Failed to fetch reading progress' });
    }
});

// Save reading progress for a book (logged-in users only)
router.post('/:bookId', isAuthenticated, async (req, res) => {
    const bookId = req.params.bookId;
    const userId = req.user.id;
    const { lastPage, totalPages } = req.body;

    if (!lastPage || lastPage < 1) {
        return res.status(400).json({ error: 'Invalid page number' });
    }

    try {
        await pool.query(
            `INSERT INTO reading_progress ("userId", "bookId", "lastPage", "totalPages", "updatedAt")
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT ("userId", "bookId")
             DO UPDATE SET "lastPage" = $3, "totalPages" = $4, "updatedAt" = NOW()`,
            [userId, bookId, lastPage, totalPages || null]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving reading progress:', err);
        res.status(500).json({ error: 'Failed to save reading progress' });
    }
});

module.exports = router;