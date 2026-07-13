const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const https = require('https');
const { pool } = require('../config/database');

// Pipe a remote HTTPS URL to an Express response stream.
// Used to proxy Cloudinary files through Render so we can set the
// Content-Disposition header with the correct .pdf filename.
function pipeRemoteUrl(url, res) {
    return new Promise((resolve, reject) => {
        https.get(url, (remote) => {
            if (remote.statusCode !== 200) {
                reject(new Error(`Upstream returned ${remote.statusCode}`));
                return;
            }
            remote.pipe(res);
            remote.on('end', resolve);
            remote.on('error', reject);
        }).on('error', reject);
    });
}

router.get('/:bookId', async (req, res) => {
  const bookId  = req.params.bookId;
  const proxyMode = req.query.proxy === 'true'; // set by the frontend for Cloudinary files

  try {
    const result = await pool.query('SELECT title, file FROM books WHERE id = $1', [bookId]);
    if (result.rows.length === 0) {
      return proxyMode
        ? res.status(404).send('Book not found')
        : res.status(404).json({ error: 'Book not found' });
    }

    const { title, file: fileUrl } = result.rows[0];
    if (!fileUrl) {
      return proxyMode
        ? res.status(404).send('No file attached to this book.')
        : res.status(404).json({ error: 'No file attached to this book.' });
    }

    const safeFilename = (title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.pdf';

    // ── Proxy mode: frontend is fetching binary to create a blob URL ───────────
    // Server fetches from Cloudinary and streams back with the correct
    // Content-Disposition so the blob download gets the right filename.
    if (proxyMode && fileUrl.includes('cloudinary.com')) {
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'private');
      try {
        await pipeRemoteUrl(fileUrl, res);
      } catch (err) {
        console.error('Cloudinary proxy error:', err);
        if (!res.headersSent) res.status(502).send('Failed to fetch file from storage.');
      }
      return;
    }

    if (fileUrl.startsWith('http')) {
      if (fileUrl.includes('cloudinary.com')) {
        // Old Cloudinary files have auto-generated public IDs with no extension.
        // fl_attachment can't include .pdf in the name (Cloudinary rejects dots in
        // transformation params), so we proxy through Render instead.
        // The frontend fetches this proxy URL as a blob, then downloads with
        // a.download = filename — which works for blob: URLs regardless of origin.
        const backendUrl = process.env.BACKEND_URL || 'https://library-backend-j90e.onrender.com';
        return res.json({
          url:      `${backendUrl}/download/${bookId}?proxy=true`,
          filename: safeFilename,
          useBlob:  true   // tells the frontend to use fetch+blob instead of window.open
        });
      }

      // GCS or any other CDN — direct public URL, correct filename already in path
      return res.json({ url: fileUrl, filename: safeFilename });

    } else {
      // Local file (development only)
      const filePath = path.join(__dirname, '../../', fileUrl);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
      res.download(filePath, safeFilename);
    }
  } catch (err) {
    console.error('Error downloading book:', err);
    if (proxyMode) return res.status(500).send('Failed to fetch book');
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

module.exports = router;