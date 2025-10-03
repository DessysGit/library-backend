const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');
const { isCloudProduction } = require('../config/environment');
const fs = require('fs');
const path = require('path');

const upload = multer({ storage: multer.memoryStorage() });

// Get all books with filters and pagination
router.get('/', async (req, res) => {
  const title = req.query.title || "";
  const author = req.query.author || "";
  const genre = req.query.genre || "";
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const isAdminUser = req.isAuthenticated() && req.user.role === 'admin';

  try {
    let query = 'SELECT * FROM books WHERE title ILIKE $1 AND author ILIKE $2';
    let params = [`%${title}%`, `%${author}%`];

    if (genre) {
      params.push(`%${genre}%`);
      query += ` AND genres ILIKE $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY title LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    const rows = result.rows;

    let countQuery = 'SELECT COUNT(*) AS total FROM books WHERE title ILIKE $1 AND author ILIKE $2';
    let countParams = [`%${title}%`, `%${author}%`];
    if (genre) {
      countParams.push(`%${genre}%`);
      countQuery += ` AND genres ILIKE $${countParams.length}`;
    }

    const countResult = await pool.query(countQuery, countParams);
    const count = countResult.rows[0].total;

    const booksWithAdminFlag = rows.map(book => ({
      ...book,
      isAdmin: isAdminUser,
      averageRating: parseFloat(book.averagerating) || 0
    }));

    // Fetch total ratings for each book
    const bookIds = booksWithAdminFlag.map(book => book.id);
    let ratingsMap = {};
    if (bookIds.length > 0) {
      const inPlaceholders = bookIds.map((_, i) => `$${i + 1}`).join(', ');
      const ratingQuery = `SELECT bookId, COUNT(*) AS totalRatings FROM reviews WHERE bookId IN (${inPlaceholders}) GROUP BY bookId`;
      const ratingsResult = await pool.query(ratingQuery, bookIds);
      ratingsMap = Object.fromEntries(ratingsResult.rows.map(r => [r.bookid, r.totalratings]));
    }
    
    booksWithAdminFlag.forEach(book => {
      book.totalRatings = ratingsMap[book.id] || 0;
    });

    res.json({ books: booksWithAdminFlag, total: count });
  } catch (err) {
    console.error('Error fetching books:', err);
    res.status(500).json({ error: 'Failed to fetch books' });
  }
});

// Get book by ID
router.get('/:id', async (req, res) => {
  const bookId = req.params.id;
  try {
    const result = await pool.query(
      'SELECT id, title, author, genres, summary, description, cover, file, averagerating, likes, dislikes FROM books WHERE id = $1',
      [bookId]
    );
    if (result.rows.length === 0) return res.status(404).send('Book not found');
    
    const book = result.rows[0];
    book.averageRating = parseFloat(book.averagerating) || 0;
    delete book.averagerating;
    
    res.json(book);
  } catch (err) {
    console.error('Error fetching book details:', err);
    res.status(500).send('Failed to fetch book details');
  }
});

// Add book (Admin only)
router.post('/', isAdmin, upload.fields([{ name: 'cover' }, { name: 'bookFile' }]), async (req, res) => {
  try {
    let coverUrl = null;
    let pdfUrl = null;

    const { title, author, description } = req.body;
    let genres = req.body.genres;
    
    if (genres) {
      try {
        genres = JSON.parse(genres);
        if (Array.isArray(genres)) {
          genres = genres.join(', ');
        }
      } catch (e) {
        // Keep as is if not JSON
      }
    } else {
      genres = '';
    }

    if (isCloudProduction) {
      // Upload to Cloudinary
      if (req.files['cover']) {
        const coverBuffer = req.files['cover'][0].buffer;
        coverUrl = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'book-covers' },
            (error, result) => error ? reject(error) : resolve(result.secure_url)
          );
          stream.end(coverBuffer);
        });
      }

      if (req.files['bookFile']) {
        const pdfBuffer = req.files['bookFile'][0].buffer;
        pdfUrl = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'book-pdfs', resource_type: 'raw', use_filename: true, unique_filename: false },
            (error, result) => error ? reject(error) : resolve(result.secure_url)
          );
          stream.end(pdfBuffer);
        });
      }
    } else {
      // Save locally
      const uploadDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

      if (req.files['cover']) {
        const coverFile = req.files['cover'][0];
        const coverPath = path.join(uploadDir, Date.now() + '-' + coverFile.originalname);
        fs.writeFileSync(coverPath, coverFile.buffer);
        coverUrl = `/uploads/${path.basename(coverPath)}`;
      }
      if (req.files['bookFile']) {
        const bookFile = req.files['bookFile'][0];
        const bookPath = path.join(uploadDir, Date.now() + '-' + bookFile.originalname);
        fs.writeFileSync(bookPath, bookFile.buffer);
        pdfUrl = `/uploads/${path.basename(bookPath)}`;
      }
    }

    await pool.query(
      'INSERT INTO books (title, author, description, genres, cover, file) VALUES ($1, $2, $3, $4, $5, $6)',
      [title, author, description, genres, coverUrl, pdfUrl]
    );
    res.status(200).send('Book added successfully');
  } catch (error) {
    console.error("Error uploading book:", error);
    res.status(500).send("Failed to upload book: " + error.message);
  }
});

// Update book (Admin only)
router.put('/:id', isAdmin, async (req, res) => {
  const bookId = req.params.id;
  const { title, author, genres, summary, description } = req.body;
  try {
    await pool.query(
      'UPDATE books SET title = $1, author = $2, genres = $3, summary = $4, description = $5 WHERE id = $6',
      [title, author, genres, summary, description, bookId]
    );
    const updatedBook = await pool.query('SELECT * FROM books WHERE id = $1', [bookId]);
    res.json(updatedBook.rows[0]);
  } catch (err) {
    console.error('Error editing book:', err);
    res.status(500).send('Failed to edit book');
  }
});

// Delete book (Admin only)
router.delete('/:id', isAdmin, async (req, res) => {
  const bookId = req.params.id;

  try {
    const row = await pool.query('SELECT cover, file FROM books WHERE id = $1', [bookId]);
    if (row.rows.length === 0) return res.status(404).send('Book not found');

    const { cover, file } = row.rows[0];

    // Delete from Cloudinary if applicable
    if (cover && cover.includes('cloudinary.com')) {
      const publicId = cover.split('/').slice(-1)[0].split('.')[0];
      await cloudinary.uploader.destroy(`book-covers/${publicId}`);
    }

    if (file && file.includes('cloudinary.com')) {
      const publicId = file.split('/').slice(-1)[0].split('.')[0];
      await cloudinary.uploader.destroy(`book-pdfs/${publicId}`, { resource_type: 'raw' });
    }

    await pool.query('DELETE FROM books WHERE id = $1', [bookId]);
    res.send('Book deleted successfully');
  } catch (e) {
    console.error('Error deleting book:', e.message);
    res.status(500).send('Failed to delete book');
  }
});

// Like book
router.post('/:id/like', isAuthenticated, async (req, res) => {
  const bookId = req.params.id;
  const userId = req.user.id;

  try {
    const row = await pool.query('SELECT action FROM likes WHERE userId = $1 AND bookId = $2', [userId, bookId]);
    if (row.rows.length > 0 && row.rows[0].action === 'like') {
      return res.status(400).send('You have already liked this book');
    }

    await pool.query('BEGIN');

    if (row.rows.length > 0 && row.rows[0].action === 'dislike') {
      await pool.query('UPDATE books SET dislikes = GREATEST(dislikes - 1, 0) WHERE id = $1', [bookId]);
    }

    await pool.query('UPDATE books SET likes = likes + 1 WHERE id = $1', [bookId]);
    await pool.query(
      'INSERT INTO likes (userId, bookId, action) VALUES ($1, $2, $3) ON CONFLICT (userId, bookId) DO UPDATE SET action = $3',
      [userId, bookId, 'like']
    );

    await pool.query('COMMIT');
    const bookResult = await pool.query('SELECT likes, dislikes FROM books WHERE id = $1', [bookId]);
    res.json(bookResult.rows[0]);
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('Error handling like action:', e);
    res.status(500).send('Failed to like book');
  }
});

// Dislike book
router.post('/:id/dislike', isAuthenticated, async (req, res) => {
  const bookId = req.params.id;
  const userId = req.user.id;

  try {
    const row = await pool.query('SELECT action FROM likes WHERE userId = $1 AND bookId = $2', [userId, bookId]);
    if (row.rows.length > 0 && row.rows[0].action === 'dislike') {
      return res.status(400).send('You have already disliked this book');
    }

    await pool.query('BEGIN');

    if (row.rows.length > 0 && row.rows[0].action === 'like') {
      await pool.query('UPDATE books SET likes = GREATEST(likes - 1, 0) WHERE id = $1', [bookId]);
    }

    await pool.query('UPDATE books SET dislikes = dislikes + 1 WHERE id = $1', [bookId]);
    await pool.query(
      'INSERT INTO likes (userId, bookId, action) VALUES ($1, $2, $3) ON CONFLICT (userId, bookId) DO UPDATE SET action = $3',
      [userId, bookId, 'dislike']
    );

    await pool.query('COMMIT');
    const bookResult = await pool.query('SELECT likes, dislikes FROM books WHERE id = $1', [bookId]);
    res.json(bookResult.rows[0]);
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('Error handling dislike action:', e);
    res.status(500).send('Failed to dislike book');
  }
});

module.exports = router;
