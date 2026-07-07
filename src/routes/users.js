const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin, isSeedAdmin } = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');
const { isCloudProduction } = require('../config/environment');
const path = require('path');
const fs = require('fs');

const upload = multer({ storage: multer.memoryStorage() });

// Get all users (Admin only)
router.get('/', isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).send('Failed to fetch users');
  }
});

// Get current user's real activity (reviews + likes)
router.get('/activity', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  try {
    // Recent reviews the user wrote
    const reviews = await pool.query(`
      SELECT
        'review'         AS type,
        r.rating,
        b.title          AS book_title,
        b.id             AS book_id,
        r.created_at
      FROM reviews r
      JOIN books b ON r.bookid = b.id
      WHERE r.userid = $1
      ORDER BY r.created_at DESC
      LIMIT 10
    `, [userId]);

    // Recent likes/dislikes (only if likes table has created_at)
    let likeRows = [];
    try {
      const likes = await pool.query(`
        SELECT
          l.action         AS type,
          b.title          AS book_title,
          b.id             AS book_id,
          l.created_at
        FROM likes l
        JOIN books b ON l.bookid = b.id
        WHERE l.userid = $1
          AND l.created_at IS NOT NULL
        ORDER BY l.created_at DESC
        LIMIT 10
      `, [userId]);
      likeRows = likes.rows;
    } catch (_) {
      // likes table has no created_at column — skip silently
    }

    const allActivity = [
      ...reviews.rows.map(r => ({
        type:      'review',
        rating:    r.rating,
        bookTitle: r.book_title,
        bookId:    r.book_id,
        createdAt: r.created_at
      })),
      ...likeRows.map(l => ({
        type:      l.type,   // 'like' or 'dislike'
        bookTitle: l.book_title,
        bookId:    l.book_id,
        createdAt: l.created_at
      }))
    ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);

    res.json(allActivity);
  } catch (err) {
    console.error('Error fetching user activity:', err);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// Get current user's own reviews (with book details)
router.get('/my-reviews', isAuthenticated, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.text,
        r.rating,
        r.created_at,
        b.title  AS book_title,
        b.id     AS book_id,
        b.author
      FROM reviews r
      JOIN books b ON r.bookid = b.id
      WHERE r.userid = $1
      ORDER BY r.created_at DESC
      LIMIT 20
    `, [userId]);

    res.json(result.rows.map(r => ({
      id:        r.id,
      text:      r.text,
      rating:    r.rating,
      bookTitle: r.book_title,
      bookId:    r.book_id,
      author:    r.author,
      createdAt: r.created_at
    })));
  } catch (err) {
    console.error('Error fetching user reviews:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Get user profile
router.get('/profile', isAuthenticated, async (req, res) => {
  const { id } = req.user;
  try {
    const result = await pool.query(
      'SELECT username, email, role, profilepicture as "profilePicture", favoritegenres as "favoriteGenres", favoriteauthors as "favoriteAuthors", favoritebooks as "favoriteBooks" FROM users WHERE id = $1',
      [id]
    );
    
    if (!result.rows[0]) {
      return res.status(404).send('User not found');
    }

    const user = result.rows[0];
    // Ensure profilePicture is always a string
    if (!user.profilePicture) {
      user.profilePicture = '';
    }

    res.json(user);
  } catch (err) {
    console.error('Profile query error:', err);
    res.status(500).send(err.message);
  }
});

// Update user profile
router.post('/updateProfile', isAuthenticated, async (req, res) => {
  const { id } = req.user;
  const { email, password, favoriteGenres, favoriteAuthors, favoriteBooks } = req.body;

  try {
    if (password) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync(password, 10);
      await pool.query(
        'UPDATE users SET email = $1, password = $2, favoriteGenres = $3, favoriteAuthors = $4, favoriteBooks = $5 WHERE id = $6',
        [email, hashedPassword, favoriteGenres, favoriteAuthors, favoriteBooks, id]
      );
    } else {
      await pool.query(
        'UPDATE users SET email = $1, favoriteGenres = $2, favoriteAuthors = $3, favoriteBooks = $4 WHERE id = $5',
        [email, favoriteGenres, favoriteAuthors, favoriteBooks, id]
      );
    }
    res.send('Profile updated successfully.');
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).send(err.message);
  }
});

// Upload profile picture
router.post('/upload-profile-picture', isAuthenticated, upload.single('profilePicture'), async (req, res) => {
  const userId = req.user.id;

  try {
    if (isCloudProduction) {
      const fileBuffer = req.file.buffer;

      const stream = cloudinary.uploader.upload_stream(
        { folder: 'profile-pictures', transformation: [{ width: 300, height: 300, crop: 'fill' }] },
        async (error, result) => {
          if (error) {
            console.error("Cloudinary error:", error);
            return res.status(500).send("Failed to upload profile picture");
          }

          await pool.query(
            'UPDATE users SET profilepicture = $1 WHERE id = $2',
            [result.secure_url, userId]
          );

          req.user.profilePicture = result.secure_url;
          res.json({ profilePicture: result.secure_url });
        }
      );
      stream.end(fileBuffer);

    } else {
      const uploadDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

      const filePath = path.join(uploadDir, req.file.originalname);
      fs.writeFileSync(filePath, req.file.buffer);

      const profilePictureUrl = `/uploads/${req.file.originalname}`;

      await pool.query(
        'UPDATE users SET profilepicture = $1 WHERE id = $2',
        [profilePictureUrl, userId]
      );

      req.user.profilePicture = profilePictureUrl;
      res.json({ profilePicture: profilePictureUrl });
    }
  } catch (err) {
    console.error("Profile upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Grant admin role (Seed admin only)
router.post('/:id/grant-admin', isSeedAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', id]);
    res.send(`User with ID ${id} granted admin role.`);
  } catch (err) {
    console.error('Error granting admin role:', err);
    res.status(500).send('Failed to grant admin role');
  }
});

// Revoke admin role (Seed admin only)
router.post('/:id/revoke-admin', isSeedAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['user', id, 'admin']);
    res.send(`User with ID ${id} revoked admin role.`);
  } catch (err) {
    console.error('Error revoking admin role:', err);
    res.status(500).send('Failed to revoke admin role');
  }
});

// Delete user (Seed admin only)
router.delete('/:id', isSeedAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [id, 'admin']);
    res.send('User deleted successfully.');
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).send('Failed to delete user');
  }
});

module.exports = router;
