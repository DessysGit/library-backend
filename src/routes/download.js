const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const url = require('url');
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
    
    // If Cloudinary URL, stream it
    if (fileUrl.startsWith('http')) {
      const parsed = url.parse(fileUrl);
      const protocol = parsed.protocol === 'https:' ? https : http;
      
      protocol.get(fileUrl, (fileRes) => {
        if (fileRes.statusCode !== 200) {
          console.warn(`Remote file not found for bookId ${bookId}: ${fileUrl} (status ${fileRes.statusCode})`);
          return res.status(404).send('File not found on remote server');
        }
        
        let ext = (parsed.pathname && parsed.pathname.split('.').pop()) || 'pdf';
        if (ext.length > 5) ext = 'pdf';
        
        res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${ext}"`);
        res.setHeader('Content-Type', fileRes.headers['content-type'] || 'application/pdf');
        fileRes.pipe(res);
      }).on('error', (e) => {
        console.error(`Error streaming remote file for bookId ${bookId}:`, e);
        res.status(500).send('Failed to download file');
      });
    } else {
      // Local file
      const filePath = path.join(__dirname, '../../', fileUrl);
      if (!fs.existsSync(filePath)) {
        console.warn(`Local file not found for bookId ${bookId}: ${filePath}`);
        return res.status(404).send('File not found');
      }
      res.download(filePath, `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
    }
  } catch (err) {
    console.error('Error downloading book:', err);
    res.status(500).send('Failed to fetch book');
  }
});

module.exports = router;
