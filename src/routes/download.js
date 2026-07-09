const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');

// Extracts a Google Drive file ID from any common sharing URL format
// and returns a direct download URL that bypasses the virus-scan warning.
function getDriveDownloadUrl(url) {
  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/uc\?.*[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      // confirm=t bypasses the "file too large to scan" warning page
      return `https://drive.google.com/uc?export=download&id=${match[1]}&confirm=t`;
    }
  }
  return url; // already a direct URL — use as-is
}

// Download book file
router.get('/:bookId', async (req, res) => {
  const bookId = req.params.bookId;
  try {
    const result = await pool.query('SELECT title, file FROM books WHERE id = $1', [bookId]);
    if (result.rows.length === 0) return res.status(404).send('Book not found');

    const { title, file: fileUrl } = result.rows[0];

    if (!fileUrl) return res.status(404).send('No file attached to this book.');

    const safeTitle = (title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase();

    if (fileUrl.includes('drive.google.com')) {
      // ── Google Drive ────────────────────────────────────────────────────────
      // Convert any sharing URL format to a direct download link.
      return res.redirect(302, getDriveDownloadUrl(fileUrl));

    } else if (fileUrl.startsWith('http')) {
      // ── Cloudinary (or any remote CDN) ─────────────────────────────────────
      // Redirect directly — do NOT inject fl_attachment because Cloudinary
      // does not support URL transformations on raw resource type and it
      // causes the redirect to fail for large files.
      // Browsers treat PDFs served via redirect correctly without it.
      return res.redirect(302, fileUrl);

    } else {
      // ── Local file (development only) ──────────────────────────────────────
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
