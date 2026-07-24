/**
 * Comprehensive Admin Management Routes
 * Handles all admin-only operations with activity logging
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { logActivity, ActivityTypes, SeverityLevels } = require('../middleware/activityLogger');

// ==================== EVENT MANAGEMENT ====================

// Get all events (including past)
router.get('/events', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, u.username as created_by_name,
             COUNT(ev."userId") as attendee_count
      FROM events e
      JOIN users u ON u.id = e."createdBy"
      LEFT JOIN event_registrations ev ON ev."eventId" = e.id
      GROUP BY e.id, u.username
      ORDER BY e."eventDate" DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create event
router.post('/events', isAdmin, async (req, res) => {
  const { title, description, eventDate, location, maxAttendees } = req.body;
  const createdBy = req.user.id;

  if (!title || !eventDate) {
    return res.status(400).json({ error: 'Title and event date are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO events (title, description, "eventDate", location, "maxAttendees", "createdBy") VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, description, eventDate, location, maxAttendees || null, createdBy]
    );

    await logActivity(createdBy, ActivityTypes.CREATE_EVENT, {
      eventId: result.rows[0].id,
      eventTitle: title,
      eventDate
    }, SeverityLevels.NEUTRAL);

    res.status(201).json({ message: 'Event created successfully!', event: result.rows[0] });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update event
router.put('/events/:id', isAdmin, async (req, res) => {
  const eventId = req.params.id;
  const { title, description, eventDate, location, maxAttendees } = req.body;

  try {
    const result = await pool.query(
      'UPDATE events SET title = $1, description = $2, "eventDate" = $3, location = $4, "maxAttendees" = $5 WHERE id = $6 RETURNING *',
      [title, description, eventDate, location, maxAttendees, eventId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await logActivity(req.user.id, ActivityTypes.CREATE_EVENT, {
      eventId,
      eventTitle: title,
      action: 'update'
    }, SeverityLevels.NEUTRAL);

    res.json({ message: 'Event updated successfully!', event: result.rows[0] });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete event
router.delete('/events/:id', isAdmin, async (req, res) => {
  const eventId = req.params.id;

  try {
    const result = await pool.query('DELETE FROM events WHERE id = $1 RETURNING id, title', [eventId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await logActivity(req.user.id, ActivityTypes.DELETE_EVENT, {
      eventId,
      eventTitle: result.rows[0].title
    }, SeverityLevels.NEUTRAL);

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Get event registrations
router.get('/events/:id/registrations', isAdmin, async (req, res) => {
  const eventId = req.params.id;

  try {
    const result = await pool.query(`
      SELECT ev.*, u.username, u.email
      FROM event_registrations ev
      JOIN users u ON u.id = ev."userId"
      WHERE ev."eventId" = $1
      ORDER BY ev."registeredAt" DESC
    `, [eventId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching registrations:', error);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

// ==================== FINE MANAGEMENT ====================

// Get all fines
router.get('/fines', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.*, u.username, u.email, b.title as book_title
      FROM fines f
      JOIN users u ON u.id = f."userId"
      LEFT JOIN borrowed_books bb ON bb.id = f."borrowId"
      LEFT JOIN books b ON b.id = bb."bookId"
      ORDER BY f."issuedAt" DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching fines:', error);
    res.status(500).json({ error: 'Failed to fetch fines' });
  }
});

// Waive fine
router.post('/fines/:id/waive', isAdmin, async (req, res) => {
  const fineId = req.params.id;
  const adminId = req.user.id;

  try {
    const result = await pool.query(
      'UPDATE fines SET status = $1, "waivedBy" = $2, "paidAt" = NOW() WHERE id = $3 RETURNING *',
      ['waived', adminId, fineId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fine not found' });
    }

    await logActivity(adminId, ActivityTypes.WAIVE_FINE, {
      fineId,
      amount: result.rows[0].amount
    }, SeverityLevels.NEUTRAL);

    res.json({ message: 'Fine waived successfully', fine: result.rows[0] });
  } catch (error) {
    console.error('Error waiving fine:', error);
    res.status(500).json({ error: 'Failed to waive fine' });
  }
});

// Adjust fine amount
router.post('/fines/:id/adjust', isAdmin, async (req, res) => {
  const fineId = req.params.id;
  const { amount } = req.body;
  const adminId = req.user.id;

  if (typeof amount !== 'number' || amount < 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    const result = await pool.query(
      'UPDATE fines SET amount = $1 WHERE id = $2 RETURNING *',
      [amount, fineId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fine not found' });
    }

    await logActivity(adminId, ActivityTypes.ADJUST_FINE, {
      fineId,
      newAmount: amount
    }, SeverityLevels.NEUTRAL);

    res.json({ message: 'Fine adjusted successfully', fine: result.rows[0] });
  } catch (error) {
    console.error('Error adjusting fine:', error);
    res.status(500).json({ error: 'Failed to adjust fine' });
  }
});

// ==================== RESERVATION MANAGEMENT ====================

// Get all reservations
router.get('/reservations', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, u.username, u.email, b.title as book_title, b.author
      FROM book_reservations r
      JOIN users u ON u.id = r."userId"
      JOIN books b ON b.id = r."bookId"
      ORDER BY r."reservedAt" DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching reservations:', error);
    res.status(500).json({ error: 'Failed to fetch reservations' });
  }
});

// Fulfill reservation
router.post('/reservations/:id/fulfill', isAdmin, async (req, res) => {
  const reservationId = req.params.id;
  const adminId = req.user.id;

  try {
    const result = await pool.query(
      'UPDATE book_reservations SET status = $1, "notifiedAt" = NOW() WHERE id = $2 AND status = $3 RETURNING *',
      ['fulfilled', reservationId, 'waiting']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found or already fulfilled' });
    }

    await logActivity(adminId, ActivityTypes.FULFILL_RESERVATION, {
      reservationId,
      bookId: result.rows[0].bookId
    }, SeverityLevels.NEUTRAL);

    res.json({ message: 'Reservation marked as fulfilled', reservation: result.rows[0] });
  } catch (error) {
    console.error('Error fulfilling reservation:', error);
    res.status(500).json({ error: 'Failed to fulfill reservation' });
  }
});

// Cancel reservation (admin)
router.delete('/reservations/:id', isAdmin, async (req, res) => {
  const reservationId = req.params.id;
  const adminId = req.user.id;

  try {
    const reservation = await pool.query('SELECT * FROM book_reservations WHERE id = $1', [reservationId]);
    
    if (reservation.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    await pool.query('DELETE FROM book_reservations WHERE id = $1', [reservationId]);

    await logActivity(adminId, ActivityTypes.CANCEL_RESERVATION_ADMIN, {
      reservationId,
      bookId: reservation.rows[0].bookId
    }, SeverityLevels.NEUTRAL);

    res.json({ message: 'Reservation cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling reservation:', error);
    res.status(500).json({ error: 'Failed to cancel reservation' });
  }
});

// ==================== BORROWING MANAGEMENT ====================

// Get all borrowed books
router.get('/borrowing', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bb.*, u.username, u.email, b.title as book_title, b.author
      FROM borrowed_books bb
      JOIN users u ON u.id = bb."userId"
      JOIN books b ON b.id = bb."bookId"
      ORDER BY bb."borrowDate" DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching borrowed books:', error);
    res.status(500).json({ error: 'Failed to fetch borrowed books' });
  }
});

// Mark book as returned
router.post('/borrowing/:id/return', isAdmin, async (req, res) => {
  const borrowId = req.params.id;
  const adminId = req.user.id;

  try {
    const result = await pool.query(
      'UPDATE borrowed_books SET status = $1, "returnDate" = NOW() WHERE id = $2 RETURNING *',
      ['returned', borrowId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Borrow record not found' });
    }

    await logActivity(adminId, ActivityTypes.RETURN, {
      bookId: result.rows[0].bookId,
      borrowId
    }, SeverityLevels.NEUTRAL);

    res.json({ message: 'Book marked as returned', borrow: result.rows[0] });
  } catch (error) {
    console.error('Error marking as returned:', error);
    res.status(500).json({ error: 'Failed to mark as returned' });
  }
});

// Get overdue books
router.get('/borrowing/overdue', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bb.*, u.username, u.email, b.title as book_title, b.author
      FROM borrowed_books bb
      JOIN users u ON u.id = bb."userId"
      JOIN books b ON b.id = bb."bookId"
      WHERE bb.status = 'borrowed'
        AND bb."dueDate" < NOW()
      ORDER BY bb."dueDate" ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching overdue books:', error);
    res.status(500).json({ error: 'Failed to fetch overdue books' });
  }
});

// ==================== USER MANAGEMENT ====================

// Get all users with activity
router.get('/users', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.email, u.role, u.created_at,
             COALESCE(COUNT(DISTINCT bb.id), 0) as total_borrows,
             COALESCE(COUNT(DISTINCT r.id), 0) as total_reviews,
             COALESCE(COUNT(DISTINCT br.id), 0) as total_reservations,
             MAX(ua."createdAt") as last_activity
      FROM public.users u
      LEFT JOIN borrowed_books bb ON bb."userId" = u.id AND bb.status = 'returned'
      LEFT JOIN reviews r ON r."userId" = u.id
      LEFT JOIN book_reservations br ON br."userId" = u.id
      LEFT JOIN user_activity ua ON ua."userId" = u.id
      GROUP BY u.id, u.username, u.email, u.role, u.created_at
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user activity log
router.get('/users/:id/activity', isAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(`
      SELECT * FROM user_activity
      WHERE "userId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 100
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({ error: 'Failed to fetch user activity' });
  }
});

// Suspend/unsuspend user
router.post('/users/:id/suspend', isAdmin, async (req, res) => {
  const userId = req.params.id;
  const adminId = req.user.id;

  try {
    const user = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newRole = user.rows[0].role === 'suspended' ? 'user' : 'suspended';
    
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [newRole, userId]);

    await logActivity(adminId, ActivityTypes.DELETE_USER, {
      targetUserId: userId,
      action: newRole === 'suspended' ? 'suspend' : 'unsuspend'
    }, SeverityLevels.NEUTRAL);

    res.json({ message: `User ${newRole === 'suspended' ? 'suspended' : 'unsuspended'} successfully` });
  } catch (error) {
    console.error('Error suspending user:', error);
    res.status(500).json({ error: 'Failed to suspend user' });
  }
});

// ==================== ACTIVITY LOGS ====================

// Get flagged/suspicious activities (MUST be before the generic /activity route)
router.get('/activity/flagged', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.username, u.email
      FROM user_activity a
      JOIN public.users u ON u.id = a."userId"
      WHERE a.severity IN ('suspicious', 'abusive')
      ORDER BY a."createdAt" DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching flagged activities:', error);
    res.status(500).json({ error: 'Failed to fetch flagged activities' });
  }
});

// Get all activity logs with filters
router.get('/activity', isAdmin, async (req, res) => {
  try {
    const { userId, type, severity, startDate, endDate, limit = 100 } = req.query;
    
    let query = `
      SELECT a.*, u.username
      FROM user_activity a
      JOIN public.users u ON u.id = a."userId"
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (userId) {
      paramCount++;
      query += ` AND a."userId" = $${paramCount}`;
      params.push(userId);
    }

    if (type) {
      paramCount++;
      query += ` AND a.type = $${paramCount}`;
      params.push(type);
    }

    if (severity) {
      paramCount++;
      query += ` AND a.severity = $${paramCount}`;
      params.push(severity);
    }

    if (startDate) {
      paramCount++;
      query += ` AND a."createdAt" >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      query += ` AND a."createdAt" <= $${paramCount}`;
      params.push(endDate);
    }

    paramCount++;
    query += ` ORDER BY a."createdAt" DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// ==================== REPORTS & EXPORT ====================

// Export users as CSV
router.get('/export/users', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.email, u.role, u.created_at,
             COUNT(DISTINCT bb.id) as total_borrows,
             COUNT(DISTINCT r.id) as total_reviews
      FROM users u
      LEFT JOIN borrowed_books bb ON bb."userId" = u.id
      LEFT JOIN reviews r ON r."userId" = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    const users = result.rows;
    const csv = convertToCSV(users, {
      id: 'User ID',
      username: 'Username',
      email: 'Email',
      role: 'Role',
      created_at: 'Created At',
      total_borrows: 'Total Borrows',
      total_reviews: 'Total Reviews'
    });

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename=users.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting users:', error);
    res.status(500).json({ error: 'Failed to export users' });
  }
});

// Export books as CSV
router.get('/export/books', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.id, b.title, b.author, b.genres, b.created_at,
             COUNT(r.id) as review_count,
           COALESCE(AVG(r.rating), 0) as avg_rating
      FROM books b
      LEFT JOIN reviews r ON r.bookid = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);

    const books = result.rows;
    const csv = convertToCSV(books, {
      id: 'Book ID',
      title: 'Title',
      author: 'Author',
      genres: 'Genres',
      created_at: 'Created At',
      review_count: 'Review Count',
      avg_rating: 'Average Rating'
    });

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename=books.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting books:', error);
    res.status(500).json({ error: 'Failed to export books' });
  }
});

// Export transactions as CSV
router.get('/export/transactions', isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bb.id, bb."borrowDate", bb."dueDate", bb."returnDate", bb.status, bb.fine,
             u.username, u.email, b.title as book_title
      FROM borrowed_books bb
      JOIN users u ON u.id = bb."userId"
      JOIN books b ON b.id = bb."bookId"
      ORDER BY bb."borrowDate" DESC
    `);

    const transactions = result.rows;
    const csv = convertToCSV(transactions, {
      id: 'Transaction ID',
      username: 'Username',
      email: 'Email',
      book_title: 'Book Title',
      borrowDate: 'Borrow Date',
      dueDate: 'Due Date',
      returnDate: 'Return Date',
      status: 'Status',
      fine: 'Fine Amount'
    });

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename=transactions.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting transactions:', error);
    res.status(500).json({ error: 'Failed to export transactions' });
  }
});

// Helper function to convert JSON to CSV
function convertToCSV(data, columnMapping) {
  if (!data || data.length === 0) {
    return '';
  }

  const headers = Object.values(columnMapping);
  const keys = Object.keys(columnMapping);

  let csv = headers.join(',') + '\n';

  data.forEach(row => {
    const values = keys.map(key => {
      const value = row[key];
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csv += values.join(',') + '\n';
  });

  return csv;
}

module.exports = router;