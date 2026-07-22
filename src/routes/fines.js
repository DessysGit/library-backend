const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Get my fines
router.get('/my', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT f.*, b.title AS "bookTitle"
       FROM fines f
       LEFT JOIN borrowed_books bb ON bb.id = f."borrowId"
       LEFT JOIN books b ON b.id = bb."bookId"
       WHERE f."userId" = $1
       ORDER BY f."issuedAt" DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching fines:', err);
    res.status(500).json({ error: 'Failed to fetch fines' });
  }
});

// Get fine summary (total unpaid)
router.get('/summary', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM fines WHERE "userId" = $1 AND status = $2',
      [userId, 'unpaid']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching fine summary:', err);
    res.status(500).json({ error: 'Failed to fetch fine summary' });
  }
});

// Pay a fine (simulated payment)
router.post('/pay/:id', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const fineId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      'SELECT id, "userId", amount, status FROM fines WHERE id = $1',
      [fineId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fine not found' });
    }

    const fine = result.rows[0];
    if (fine.userId !== userId) {
      return res.status(403).json({ error: 'You can only pay your own fines' });
    }

    if (fine.status === 'paid') {
      return res.status(400).json({ error: 'This fine has already been paid' });
    }

    await pool.query(
      'UPDATE fines SET status = $1, "paidAt" = NOW() WHERE id = $2',
      ['paid', fineId]
    );

    res.json({ message: `Fine of GHS ${fine.amount.toFixed(2)} paid successfully. Thank you!` });
  } catch (err) {
    console.error('Error paying fine:', err);
    res.status(500).json({ error: 'Failed to pay fine' });
  }
});

// Pay all unpaid fines
router.post('/pay-all', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM fines WHERE "userId" = $1 AND status = $2',
      [userId, 'unpaid']
    );
    const total = parseFloat(result.rows[0].total);

    if (total === 0) {
      return res.status(400).json({ error: 'You have no unpaid fines' });
    }

    await pool.query(
      'UPDATE fines SET status = $1, "paidAt" = NOW() WHERE "userId" = $2 AND status = $3',
      ['paid', userId, 'unpaid']
    );

    res.json({ message: `All fines paid! Total: GHS ${total.toFixed(2)}` });
  } catch (err) {
    console.error('Error paying all fines:', err);
    res.status(500).json({ error: 'Failed to pay all fines' });
  }
});

// List all fines (Admin only)
router.get('/all', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*, u.username, u.email, b.title AS "bookTitle"
       FROM fines f
       JOIN users u ON u.id = f."userId"
       LEFT JOIN borrowed_books bb ON bb.id = f."borrowId"
       LEFT JOIN books b ON b.id = bb."bookId"
       ORDER BY f."issuedAt" DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing all fines:', err);
    res.status(500).json({ error: 'Failed to list fines' });
  }
});

// Waive a fine (Admin only)
router.post('/waive/:id', isAdmin, async (req, res) => {
  const fineId = parseInt(req.params.id);
  const adminId = req.user.id;

  try {
    const result = await pool.query(
      'UPDATE fines SET status = $1, "waivedBy" = $2 WHERE id = $3 AND status = $4 RETURNING *',
      ['waived', adminId, fineId, 'unpaid']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fine not found or already paid/waived' });
    }

    res.json({ message: 'Fine waived successfully', fine: result.rows[0] });
  } catch (err) {
    console.error('Error waiving fine:', err);
    res.status(500).json({ error: 'Failed to waive fine' });
  }
});

module.exports = router;