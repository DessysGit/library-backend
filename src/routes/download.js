const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');

// Download book file
router.get('/:bookId', async (req, res) => {
  const bookId = req.params.bookId;
  try {
    const result = await pool.query('SELECT title, file FROM books WHERE id = $1', [bookId]);
    if (result.rows.length === 0) return res.status(404).send('Book not found');

    const { title, file: fileUrl } = result.rows[0];
    if (!fileUrl) return res.status(404).send('No file attached to this book.');

    const safeTitle = (title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase();

    if (fileUrl.startsWith('http')) {
      // Google Cloud Storage and Cloudinary are both direct public URLs.
      // A plain redirect is all that is needed — the browser downloads straight
      // from the CDN with no Render timeout risk regardless of file size.
      return res.redirect(302, fileUrl);

    } else {
      // Local file (development only)
      const filePath = path.join(__dirname, '../../', fileUrl);
      if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
      res.download(filePath, `${safeTitle}.pdf`);
    }
  } catch (err) {
    console.error('Error downloading book:', err);
    res.status(500).send('Failed to fetch book');
  }
});

module.exports = router;
