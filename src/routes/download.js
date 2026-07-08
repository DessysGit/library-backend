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
    if (result.rows.length === 0) {
      return res.status(404).send('Book not found');
    }

    const { title, file: fileUrl } = result.rows[0];
    const safeTitle = (title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase();

    if (fileUrl && fileUrl.startsWith('http')) {
      // ── Cloudinary (or any remote) file ──────────────────────────────────
      // Instead of proxying through Render (which has a 30-second timeout and
      // limited bandwidth on the free tier), redirect the browser directly to
      // Cloudinary. Cloudinary's CDN handles the transfer at full speed with no
      // timeout risk regardless of file size.
      //
      // We inject the fl_attachment flag so Cloudinary sends:
      //   Content-Disposition: attachment; filename="<safeTitle>.pdf"
      // which makes the browser download the file instead of opening it.
      let downloadUrl = fileUrl;
      if (fileUrl.includes('cloudinary.com') && fileUrl.includes('/upload/')) {
        downloadUrl = fileUrl.replace('/upload/', `/upload/fl_attachment:${safeTitle}/`);
      }
      return res.redirect(302, downloadUrl);

    } else {
      // ── Local file (development only) ─────────────────────────────────────
      const filePath = path.join(__dirname, '../../', fileUrl);
      if (!fs.existsSync(filePath)) {
        console.warn(`Local file not found for bookId ${bookId}: ${filePath}`);
        return res.status(404).send('File not found');
      }
      res.download(filePath, `${safeTitle}.pdf`);
    }
  } catch (err) {
    console.error('Error downloading book:', err);
    res.status(500).send('Failed to fetch book');
  }
});

module.exports = router;
