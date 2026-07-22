const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Reserve a book (join waiting queue)
router.post('/:bookId', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const bookId = parseInt(req.params.bookId);

  try {
    // Check book exists
    const bookResult = await pool.query('SELECT id, title FROM books WHERE id = $1', [bookId]);
    if (bookResult.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Check if already reserved by this user
    const existing = await pool.query(
      'SELECT id, status FROM book_reservations WHERE "userId" = $1 AND "bookId" = $2 AND status = $3',
      [userId, bookId, 'waiting']
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You already have an active reservation for this book' });
    }

    // Check if book is currently available (not borrowed)
    const activeBorrow = await pool.query(
      'SELECT id FROM borrowed_books WHERE "bookId" = $1 AND status = $2',
      [bookId, 'borrowed']
    );
    if (activeBorrow.rows.length === 0) {
      return res.status(400).json({ error: 'This book is currently available. You can borrow it directly!' });
    }

    // Get current queue position
    const queueResult = await pool.query(
      'SELECT COUNT(*) AS position FROM book_reservations WHERE "bookId" = $1 AND status = $2',
      [bookId, 'waiting']
    );
    const queuePosition = parseInt(queueResult.rows[0].position) + 1;

    const result = await pool.query(
      'INSERT INTO book_reservations ("userId", "bookId", "queuePosition") VALUES ($1, $2, $3) RETURNING id, "reservedAt", "queuePosition"',
      [userId, bookId, queuePosition]
    );

    res.status(201).json({
      message: `You are #${queuePosition} in the queue for "${bookResult.rows[0].title}". We'll notify you when it's available!`,
      reservation: result.rows[0]
    });
  } catch (err) {
    console.error('Error reserving book:', err);
    res.status(500).json({ error: 'Failed to reserve book' });
  }
});

// Get my reservations
router.get('/my', isAuthenticated, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT r.id, r."reservedAt", r."queuePosition", r.status,
              b.id AS "bookId", b.title, b.author, b.cover
       FROM book_reservations r
       JOIN books b ON b.id = r."bookId"
       WHERE r."userId" = $1
       ORDER BY r."reservedAt" DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching reservations:', err);
    res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

// Cancel a reservation
router.delete('/:id', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  const reservationId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      'SELECT id, "userId", status FROM book_reservations WHERE id = $1',
      [reservationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    const reservation = result.rows[0];
    if (reservation.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only cancel your own reservations' });
    }

    await pool.query('DELETE FROM book_reservations WHERE id = $1', [reservationId]);

    // Recalculate queue positions for remaining reservations
    await pool.query(
      `UPDATE book_reservations SET "queuePosition" = subq.new_pos
       FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY "reservedAt" ASC) AS new_pos
         FROM book_reservations
         WHERE "bookId" = (SELECT "bookId" FROM book_reservations WHERE id = $1) AND status = 'waiting'
       ) subq
       WHERE book_reservations.id = subq.id`,
      [reservationId]
    );

    res.json({ message: 'Reservation cancelled successfully' });
  } catch (err) {
    console.error('Error cancelling reservation:', err);
    res.status(500).json({ error: 'Failed to cancel reservation' });
  }
});

// List all reservations (Admin only)
router.get('/all', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.username, u.email, b.title AS "bookTitle"
       FROM book_reservations r
       JOIN users u ON u.id = r."userId"
       JOIN books b ON b.id = r."bookId"
       ORDER BY r."reservedAt" DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing reservations:', err);
    res.status(500).json({ error: 'Failed to list reservations' });
  }
});

// Mark reservation as fulfilled (Admin only - when book is returned)
router.post('/fulfill/:id', isAdmin, async (req, res) => {
  const reservationId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      'UPDATE book_reservations SET status = $1, "notifiedAt" = NOW() WHERE id = $2 AND status = $3 RETURNING *',
      ['fulfilled', reservationId, 'waiting']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found or already fulfilled' });
    }

    res.json({ message: 'Reservation marked as fulfilled. User notified.', reservation: result.rows[0] });
  } catch (err) {
    console.error('Error fulfilling reservation:', err);
    res.status(500).json({ error: 'Failed to fulfill reservation' });
  }
});

module.exports = router;
</parameter>
<parameter=task_progress>
- [x] Phase 1-7: Complete all existing work
- [ ] Feature 1: Book Reservation & Queue System
- [ ] Feature 2: Fine Management & Payment System
- [ ] Feature 3: Enhanced Events with Calendar & Notifications
- [ ] Feature 4: Community Analytics Dashboard
- [ ] Feature 5: Reading Challenges & Goals
</parameter>
</write_to_file>