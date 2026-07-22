const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Create a reading challenge (Admin only)
router.post('/', isAdmin, async (req, res) => {
  const { title, description, goalBooks, endDate } = req.body;
  const createdBy = req.user.id;

  if (!title || !goalBooks) {
    return res.status(400).json({ error: 'Title and goal books are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO reading_challenges (title, description, "goalBooks", "endDate", "createdBy") VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title, description, goalBooks, endDate || null, createdBy]
    );
    res.status(201).json({ message: 'Reading challenge created!', challenge: result.rows[0] });
  } catch (err) {
    console.error('Error creating challenge:', err);
    res.status(500).json({ error: 'Failed to create challenge' });
  }
});

// List active challenges
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.username AS "createdByUsername",
              (SELECT COUNT(*) FROM user_challenges WHERE "challengeId" = c.id) AS participants
       FROM reading_challenges c
       JOIN users u ON u.id = c."createdBy"
       WHERE c.status = 'active'
       ORDER BY c."startDate" DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing challenges:', err);
    res.status(500).json({ error: 'Failed to list challenges' });
  }
});

// Join a challenge
router.post('/:id/join', isAuthenticated, async (req, res) => {
  const challengeId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    const existing = await pool.query(
      'SELECT id FROM user_challenges WHERE "challengeId" = $1 AND "userId" = $2',
      [challengeId, userId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You have already joined this challenge' });
    }

    await pool.query(
      'INSERT INTO user_challenges ("challengeId", "userId") VALUES ($1, $2)',
      [challengeId, userId]
    );

    res.status(201).json({ message: 'You joined the challenge! Start reading!' });
  } catch (err) {
    console.error('Error joining challenge:', err);
    res.status(500).json({ error: 'Failed to join challenge' });
  }
});

// Update reading progress (increment books read)
router.post('/:id/progress', isAuthenticated, async (req, res) => {
  const challengeId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    const challenge = await pool.query(
      'SELECT id, "goalBooks" FROM reading_challenges WHERE id = $1',
      [challengeId]
    );
    if (challenge.rows.length === 0) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const userChallenge = await pool.query(
      'SELECT id, "booksRead" FROM user_challenges WHERE "challengeId" = $1 AND "userId" = $2',
      [challengeId, userId]
    );
    if (userChallenge.rows.length === 0) {
      return res.status(400).json({ error: 'You have not joined this challenge' });
    }

    const currentRead = parseInt(userChallenge.rows[0].booksRead);
    const goalBooks = parseInt(challenge.rows[0].goalBooks);
    const newRead = currentRead + 1;

    // Check if challenge is completed
    const isCompleted = newRead >= goalBooks;

    await pool.query(
      'UPDATE user_challenges SET "booksRead" = $1, "completedAt" = $2 WHERE id = $3',
      [newRead, isCompleted ? new Date() : null, userChallenge.rows[0].id]
    );

    // Award badge if completed
    if (isCompleted) {
      await pool.query(
        'INSERT INTO badges ("userId", name, description, icon) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [userId, `Challenge Complete: ${challenge.rows[0].title}`, `Read ${goalBooks} books in a reading challenge!`, '📚']
      );
    }

    res.json({
      message: isCompleted
        ? `🎉 Congratulations! You completed the challenge! You've earned a badge!`
        : `Progress updated! ${newRead}/${goalBooks} books read.`,
      booksRead: newRead,
      goalBooks,
      completed: isCompleted
    });
  } catch (err) {
    console.error('Error updating progress:', err);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Get my challenges
router.get('/my', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT uc.*, c.title, c.description, c."goalBooks", c."endDate",
              c.status AS "challengeStatus"
       FROM user_challenges uc
       JOIN reading_challenges c ON c.id = uc."challengeId"
       WHERE uc."userId" = $1
       ORDER BY uc."joinedAt" DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching my challenges:', err);
    res.status(500).json({ error: 'Failed to fetch challenges' });
  }
});

// Get my badges
router.get('/badges', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'SELECT * FROM badges WHERE "userId" = $1 ORDER BY "awardedAt" DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching badges:', err);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
});

// Leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.username, u."profilePicture",
              COUNT(bb.id) AS "booksBorrowed",
              (SELECT COUNT(*) FROM badges WHERE "userId" = u.id) AS badges
       FROM users u
       LEFT JOIN borrowed_books bb ON bb."userId" = u.id AND bb.status = 'returned'
       GROUP BY u.id
       ORDER BY "booksBorrowed" DESC
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;