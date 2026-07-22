const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Checkout / borrow a physical book
router.post('/:bookId', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const bookId = parseInt(req.params.bookId);

  try {
    // Check if user is a library member
    const userResult = await pool.query(
      'SELECT "isLibraryMember" FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows[0]?.isLibraryMember) {
      return res.status(403).json({ error: 'You need an active library membership to borrow books. Apply at /membership/apply' });
    }

    // Check if book exists
    const bookResult = await pool.query('SELECT id, title FROM books WHERE id = $1', [bookId]);
    if (bookResult.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Check if book is currently borrowed
    const activeBorrow = await pool.query(
      'SELECT id FROM borrowed_books WHERE "bookId" = $1 AND status = $2',
      [bookId, 'borrowed']
    );
    if (activeBorrow.rows.length > 0) {
      return res.status(400).json({ error: 'This book is currently checked out by another member' });
    }

    // Check borrowing limit (max 5 books at a time)
    const borrowCount = await pool.query(
      'SELECT COUNT(*) AS count FROM borrowed_books WHERE "userId" = $1 AND status = $2',
      [userId, 'borrowed']
    );
    if (parseInt(borrowCount.rows[0].count) >= 5) {
      return res.status(400).json({ error: 'You have reached the maximum borrowing limit (5 books). Return some books first.' });
    }

    // Create borrow record (14-day borrowing period)
    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const result = await pool.query(
      'INSERT INTO borrowed_books ("userId", "bookId", "dueDate") VALUES ($1, $2, $3) RETURNING id, "borrowDate", "dueDate"',
      [userId, bookId, dueDate]
    );

    res.status(201).json({
      message: `Successfully borrowed "${bookResult.rows[0].title}". Due back: ${dueDate.toLocaleDateString()}`,
      borrow: result.rows[0]
    });
  } catch (err) {
    console.error('Error borrowing book:', err);
    res.status(500).json({ error: 'Failed to borrow book' });
  }
});

// Return a borrowed book
router.post('/return/:borrowId', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const borrowId = parseInt(req.params.borrowId);

  try {
    const result = await pool.query(
      'SELECT id, "userId", "dueDate", status FROM borrowed_books WHERE id = $1',
      [borrowId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Borrow record not found' });
    }

    const borrow = result.rows[0];

    // Only the borrower or an admin can return
    if (borrow.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only return books you borrowed' });
    }

    if (borrow.status === 'returned') {
      return res.status(400).json({ error: 'This book has already been returned' });
    }

    // Calculate fine if overdue (1 GHS per day overdue)
    const now = new Date();
    const dueDate = new Date(borrow.dueDate);
    let fine = 0;
    if (now > dueDate) {
      const daysOverdue = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
      fine = daysOverdue * 1.00; // 1 GHS per day
    }

    await pool.query(
      'UPDATE borrowed_books SET "returnDate" = NOW(), status = $1, fine = $2 WHERE id = $3',
      ['returned', fine, borrowId]
    );

    const message = fine > 0 
      ? `Book returned successfully. An overdue fine of GHS ${fine.toFixed(2)} has been applied.`
      : 'Book returned successfully. Thank you!';

    res.json({ message, fine });
  } catch (err) {
    console.error('Error returning book:', err);
    res.status(500).json({ error: 'Failed to return book' });
  }
});

// Renew / extend borrowing
router.post('/renew/:borrowId', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const borrowId = parseInt(req.params.borrowId);

  try {
    const result = await pool.query(
      'SELECT id, "userId", "dueDate", status FROM borrowed_books WHERE id = $1',
      [borrowId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Borrow record not found' });
    }

    const borrow = result.rows[0];

    if (borrow.userId !== userId) {
      return res.status(403).json({ error: 'You can only renew your own borrowed books' });
    }

    if (borrow.status === 'returned') {
      return res.status(400).json({ error: 'This book has already been returned' });
    }

    // Extend by 7 more days from current due date
    const currentDue = new Date(borrow.dueDate);
    const newDueDate = new Date(currentDue.getTime() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      'UPDATE borrowed_books SET "dueDate" = $1 WHERE id = $2',
      [newDueDate, borrowId]
    );

    res.json({ 
      message: `Borrowing period extended. New due date: ${newDueDate.toLocaleDateString()}`,
      newDueDate
    });
  } catch (err) {
    console.error('Error renewing borrow:', err);
    res.status(500).json({ error: 'Failed to renew borrowing' });
  }
});

// Get my borrowed books
router.get('/my', isAuthenticated, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT bb.id, bb."borrowDate", bb."dueDate", bb."returnDate", bb.status, bb.fine,
              b.id AS "bookId", b.title, b.author, b.cover
       FROM borrowed_books bb
       JOIN books b ON b.id = bb."bookId"
       WHERE bb."userId" = $1
       ORDER BY bb."borrowDate" DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching borrowed books:', err);
    res.status(500).json({ error: 'Failed to fetch borrowed books' });
  }
});

// List all borrows (Admin only)
router.get('/all', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT bb.*, u.username, u.email, b.title AS "bookTitle", b.author
       FROM borrowed_books bb
       JOIN users u ON u.id = bb."userId"
       JOIN books b ON b.id = bb."bookId"
       ORDER BY bb."borrowDate" DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing all borrows:', err);
    res.status(500).json({ error: 'Failed to list borrows' });
  }
});

module.exports = router;