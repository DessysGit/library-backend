const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');

router.get('/:bookId', async (req, res) => {
  const bookId = req.params.bookId;
  try {
    const result = await pool.query('SELECT title, file FROM books WHERE id = $1', [bookId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Book not found' });

    const { title, file: fileUrl } = result.rows[0];
    if (!fileUrl) return res.status(404).json({ error: 'No file attached to this book.' });

    const safeFilename = (title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.pdf';

    if (fileUrl.startsWith('http')) {
      let downloadUrl = fileUrl;

      // For Cloudinary URLs: inject fl_attachment:filename so Cloudinary sends
      // Content-Disposition: attachment; filename="book_title.pdf"
      // Strip the .pdf extension from the attachment name — Cloudinary's URL parser
      // treats dots as extension separators and returns 400 if they appear in the
      // transformation parameter. Cloudinary appends the original file extension
      // automatically, so the downloaded file still gets the .pdf suffix.
      if (fileUrl.includes('cloudinary.com') && fileUrl.includes('/upload/')) {
        const attachmentName = safeFilename.replace(/\.pdf$/i, '');
        downloadUrl = fileUrl.replace('/upload/', `/upload/fl_attachment:${attachmentName}/`);
      }

      return res.json({ url: downloadUrl, filename: safeFilename });
    } else {
      const filePath = path.join(__dirname, '../../', fileUrl);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
      res.download(filePath, safeFilename);
    }
  } catch (err) {
    console.error('Error downloading book:', err);
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

module.exports = router;