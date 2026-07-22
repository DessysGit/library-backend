const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const crypto = require('crypto');

// Apply for library membership
router.post('/apply', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const { membershipType = 'standard' } = req.body;

  try {
    // Check if user already has a membership
    const existing = await pool.query(
      'SELECT id, status FROM memberships WHERE "userId" = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      const membership = existing.rows[0];
      if (membership.status === 'active') {
        return res.status(400).json({ error: 'You already have an active membership' });
      }
      // Reactivate if expired
      const cardNumber = 'TCL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      await pool.query(
        'UPDATE memberships SET status = $1, "membershipType" = $2, "startDate" = NOW(), "endDate" = $3, "libraryCardNumber" = $4 WHERE id = $5',
        ['active', membershipType, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), cardNumber, membership.id]
      );
      await pool.query('UPDATE users SET "isLibraryMember" = TRUE WHERE id = $1', [userId]);
      return res.json({ message: 'Membership renewed successfully!', cardNumber });
    }

    // Create new membership
    const cardNumber = 'TCL-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

    await pool.query(
      'INSERT INTO memberships ("userId", "membershipType", "endDate", "libraryCardNumber") VALUES ($1, $2, $3, $4)',
      [userId, membershipType, endDate, cardNumber]
    );

    await pool.query('UPDATE users SET "isLibraryMember" = TRUE WHERE id = $1', [userId]);

    res.status(201).json({ 
      message: 'Welcome to the Tesano Community Library! Your membership is active.', 
      cardNumber,
      validUntil: endDate
    });
  } catch (err) {
    console.error('Error applying for membership:', err);
    res.status(500).json({ error: 'Failed to process membership application' });
  }
});

// Check membership status
router.get('/status', isAuthenticated, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      'SELECT * FROM memberships WHERE "userId" = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        isMember: false,
        message: 'You do not have a library membership yet.'
      });
    }

    const membership = result.rows[0];
    const isExpired = membership.endDate && new Date(membership.endDate) < new Date();

    res.json({
      isMember: membership.status === 'active' && !isExpired,
      membershipType: membership.membershipType,
      cardNumber: membership.libraryCardNumber,
      startDate: membership.startDate,
      endDate: membership.endDate,
      status: isExpired ? 'expired' : membership.status
    });
  } catch (err) {
    console.error('Error checking membership:', err);
    res.status(500).json({ error: 'Failed to check membership status' });
  }
});

// Renew membership
router.post('/renew', isAuthenticated, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      'SELECT id FROM memberships WHERE "userId" = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No existing membership to renew. Please apply first.' });
    }

    const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await pool.query(
      'UPDATE memberships SET status = $1, "startDate" = NOW(), "endDate" = $2 WHERE "userId" = $3',
      ['active', endDate, userId]
    );

    res.json({ message: 'Membership renewed successfully!', validUntil: endDate });
  } catch (err) {
    console.error('Error renewing membership:', err);
    res.status(500).json({ error: 'Failed to renew membership' });
  }
});

// List all members (Admin only)
router.get('/all', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m."membershipType", m.status, m."libraryCardNumber", m."startDate", m."endDate",
              u.username, u.email
       FROM memberships m
       JOIN users u ON u.id = m."userId"
       ORDER BY m.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing members:', err);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

module.exports = router;