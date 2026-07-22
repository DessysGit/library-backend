const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Create a community event (Admin only)
router.post('/', isAdmin, async (req, res) => {
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

    res.status(201).json({ message: 'Event created successfully!', event: result.rows[0] });
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// List upcoming events
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, u.username AS "createdByUsername",
              (SELECT COUNT(*) FROM event_registrations WHERE "eventId" = e.id) AS "registrations"
       FROM events e
       JOIN users u ON u.id = e."createdBy"
       WHERE e."eventDate" >= NOW()
       ORDER BY e."eventDate" ASC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing events:', err);
    res.status(500).json({ error: 'Failed to list events' });
  }
});

// Get event details
router.get('/:id', async (req, res) => {
  const eventId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      `SELECT e.*, u.username AS "createdByUsername",
              (SELECT COUNT(*) FROM event_registrations WHERE "eventId" = e.id) AS "registrations"
       FROM events e
       JOIN users u ON u.id = e."createdBy"
       WHERE e.id = $1`,
      [eventId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching event:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Register for an event
router.post('/:id/register', isAuthenticated, async (req, res) => {
  const eventId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    // Check if event exists and has space
    const eventResult = await pool.query(
      `SELECT id, "maxAttendees",
              (SELECT COUNT(*) FROM event_registrations WHERE "eventId" = $1) AS "registrations"
       FROM events WHERE id = $1`,
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];
    if (event.maxAttendees && parseInt(event.registrations) >= event.maxAttendees) {
      return res.status(400).json({ error: 'This event is fully booked' });
    }

    // Check if already registered
    const existing = await pool.query(
      'SELECT id FROM event_registrations WHERE "eventId" = $1 AND "userId" = $2',
      [eventId, userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You are already registered for this event' });
    }

    await pool.query(
      'INSERT INTO event_registrations ("eventId", "userId") VALUES ($1, $2)',
      [eventId, userId]
    );

    res.status(201).json({ message: 'Successfully registered for the event!' });
  } catch (err) {
    console.error('Error registering for event:', err);
    res.status(500).json({ error: 'Failed to register for event' });
  }
});

// Delete an event (Admin only)
router.delete('/:id', isAdmin, async (req, res) => {
  const eventId = parseInt(req.params.id);

  try {
    const result = await pool.query('DELETE FROM events WHERE id = $1 RETURNING id', [eventId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    console.error('Error deleting event:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

module.exports = router;