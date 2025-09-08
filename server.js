const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const passport = require('passport');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const LocalStrategy = require('passport-local').Strategy;
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const upload = multer({ storage: multer.memoryStorage() });
const fs = require('fs');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { spawn } = require('child_process');
require('dotenv').config();
const http = require('http');
const https = require('https');
const url = require('url');



const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://strong-paletas-464b32.netlify.app'
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Trust proxy (must come before rate limiting & sessions)
app.set('trust proxy', 1);

// JSON & URL parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,                   // keep it low for Supabase free tier
  idleTimeoutMillis: 30000, // close idle connections after 30s
  connectionTimeoutMillis: 5000 // fail fast if DB can’t connect
});

pool.on("error", (err) => {
  console.error("Unexpected DB error", err);
});


// Create tables & seed admin
async function ensureTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT,
        email TEXT,
        profilePicture TEXT,
        favoriteGenres TEXT,
        favoriteAuthors TEXT,
        favoriteBooks TEXT
      );

      CREATE TABLE IF NOT EXISTS books (
        id SERIAL PRIMARY KEY,
        title TEXT,
        author TEXT,
        description TEXT,
        genres TEXT,
        cover TEXT,
        file TEXT,
        likes INTEGER DEFAULT 0,
        dislikes INTEGER DEFAULT 0,
        summary TEXT,
        averageRating FLOAT
      );

      CREATE TABLE IF NOT EXISTS likes (
        id SERIAL PRIMARY KEY,
        userId INTEGER,
        bookId INTEGER,
        action TEXT,
        UNIQUE(userId, bookId)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        bookId INTEGER,
        userId INTEGER,
        username TEXT,
        text TEXT,
        rating INTEGER
      );
    `);
    console.log("✅ Tables ensured successfully.");
  } catch (err) {
    console.error("❌ Error ensuring tables:", err);
  }
}

async function seedAdmin() {
  try {
    // Read admin username/password from environment variables
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'adminpassword';

    const result = await pool.query(
      'SELECT COUNT(*) AS count FROM users WHERE username = $1',
      [adminUsername]
    );

    if (parseInt(result.rows[0].count, 10) === 0) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        [adminUsername, hashedPassword, 'admin']
      );
      console.log('✅ Admin user seeded successfully.');
    } else {
      console.log('ℹ️ Admin user already exists.');
    }
  } catch (err) {
    console.error("❌ Error seeding admin user:", err);
  }
}

// Run setup immediately at startup
(async () => {
  await ensureTables();
  await seedAdmin();
})();



// Recalculate averageRating for all books
const recalculateAverageRatings = async () => {
    const booksResult = await pool.query('SELECT id FROM books');
    const books = booksResult.rows;

    for (const book of books) {
        const row = await pool.query('SELECT AVG(rating) AS averageRating FROM reviews WHERE bookId = $1', [book.id]);
        const averageRating = row.rows[0]?.averageRating || 0;
        await pool.query('UPDATE books SET averageRating = $1 WHERE id = $2', [averageRating, book.id]);
    }
};

// Call the function during server startup
recalculateAverageRatings();

// Configure Passport.js for authentication
passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user || !bcrypt.compareSync(password, user.password)) return done(null, false, { message: 'Incorrect username or password.' });
        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        const user = result.rows[0];
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Session Configuration
const PgSession = require('connect-pg-simple')(session);

app.use(session({
  store: new PgSession({
    pool: pool,                    // your pg Pool
    tableName: 'session',          // default table name
    createTableIfMissing: true,    // auto-create table
    schemaName: 'public'           // explicitly set schema
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'sessionId',               // explicitly set session name
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,                // add for security
    maxAge: 24 * 60 * 60 * 1000,  // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));


app.use(passport.initialize());
app.use(passport.session());

// Configure Cloudinary from .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Helper to check if running in production (on Render, etc.)
const isCloudProduction = process.env.NODE_ENV === 'production' || process.env.FORCE_CLOUDINARY === 'true';

// Authentication check middleware
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    res.status(401).send('You must be logged in to perform this action.');
};

// Profile picture upload endpoint
app.post('/upload-profile-picture', isAuthenticated, upload.single('profilePicture'), async (req, res) => {
  const userId = req.user.id;
  const useCloudinary = isCloudProduction;

  try {
    let profilePictureUrl = null;

    if (useCloudinary) {
      const fileBuffer = req.file.buffer;

      // Upload to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'profile-pictures', transformation: [{ width: 300, height: 300, crop: 'fill' }] },
          (error, result) => {
            if (error) {
              console.error("Cloudinary error:", error);
              return reject(error);
            }
            resolve(result);
          }
        );
        stream.end(fileBuffer);
      });

      profilePictureUrl = result.secure_url;
    } else {
      // Fallback: local /uploads
      const uploadDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

      const fileName = Date.now() + '-' + req.file.originalname;
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, req.file.buffer);

      profilePictureUrl = `/uploads/${fileName}`;
    }

    // Update database
    await pool.query(
      'UPDATE users SET profilePicture = $1 WHERE id = $2',
      [profilePictureUrl, userId]
    );

    // IMPORTANT: Update the session object so it persists across requests
    req.user.profilePicture = profilePictureUrl;

    // Also save the session explicitly to ensure it's written to the store
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
      }
    });

    res.json({ profilePicture: profilePictureUrl });

  } catch (err) {
    console.error("Profile upload error:", err);
    res.status(500).json({ error: "Upload failed: " + err.message });
  }
});


// Endpoint to get user profile
app.get('/profile', isAuthenticated, async (req, res) => {
  const { id } = req.user;
  try {
    const result = await pool.query(
      'SELECT username, email, role, profilePicture, favoriteGenres, favoriteAuthors, favoriteBooks FROM users WHERE id = $1',
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});


// Endpoint to update user profile
app.post('/updateProfile', isAuthenticated, async (req, res) => {
    const { id } = req.user;
    const { email, password, favoriteGenres, favoriteAuthors, favoriteBooks } = req.body;

    try {
        if (password) {
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
        res.status(500).send(err.message);
    }
});

// Path to the file where email addresses will be stored
const subscribersFilePath = path.join(__dirname, 'subscribers.txt');

// Newsletter subscription endpoint
app.post('/subscribe', isAuthenticated, (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).send('Email is required');
    }

    let subscribers = [];
    if (fs.existsSync(subscribersFilePath)) {
        subscribers = fs.readFileSync(subscribersFilePath, 'utf-8').split('\n').filter(Boolean);
    }

    if (subscribers.includes(email)) {
        return res.status(400).send('Email is already subscribed');
    }

    fs.appendFileSync(subscribersFilePath, email + '\n');
    res.send('Subscribed successfully');
});

// Endpoint to fetch books
app.get('/books', async (req, res) => {
    const title = req.query.title || "";
    const author = req.query.author || "";
    const genre = req.query.genre || "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const isAdmin = req.isAuthenticated() && req.user.role === 'admin';

    let query = 'SELECT * FROM books WHERE title ILIKE $1 AND author ILIKE $2';
let params = [`%${title}%`, `%${author}%`];

// If genre filter exists, add it and use the next available param number
if (genre) {
  params.push(`%${genre}%`);
  query += ` AND genres ILIKE $${params.length}`;
}

// Add LIMIT and OFFSET with correct numbering
params.push(limit);
query += ` ORDER BY title LIMIT $${params.length}`;
params.push(offset);
query += ` OFFSET $${params.length}`;

const result = await pool.query(query, params);
const rows = result.rows;

// Count query should also handle genre for consistent pagination
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
  isAdmin: isAdmin
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
});

// Endpoint to fetch book details by ID
app.get('/books/:id', async (req, res) => {
  const bookId = req.params.id;
  try {
    const result = await pool.query(
      'SELECT id, title, author, genres, summary, description, cover, file, averageRating, likes, dislikes FROM books WHERE id = $1',
      [bookId]
    );
    if (result.rows.length === 0) return res.status(404).send('Book not found');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send('Failed to fetch book details');
  }
});


// Register route
app.post('/register', [
    body('username').isLength({ min: 3 }).withMessage('Username must be at least 3 characters long'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        await pool.query(
            'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
            [username, hashedPassword, 'user']
        );
        res.send('User registered successfully.');
    } catch (err) {
        console.error('Error registering user:', err);
        res.status(400).send(err.message);
    }
});

// Login route
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login requests per windowMs
    message: 'Too many login attempts, please try again later.'
});
app.post('/login', loginLimiter, (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) { return next(err); }
        if (!user) { return res.status(401).send('Incorrect username or password'); }
        req.logIn(user, (err) => {
            if (err) { return next(err); }
            res.json(user); // Send the user info including the role
        });
    })(req, res, next);
});

// Logout route
app.post('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.send('Logged out successfully.');
    });
});

// Current user route
app.get('/current-user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json(req.user);
    } else {
        res.status(401).send('Not authenticated');
    }
});

// Seed admin username
const seedAdminUsername = 'admin';

// Seed admin check middleware
const isSeedAdmin = (req, res, next) => {
    if (req.isAuthenticated() && req.user.username === seedAdminUsername) return next();
    res.status(403).send('Only the seeded admin can perform this action.');
};

// Admin check middleware
const isAdmin = (req, res, next) => {
    if (req.isAuthenticated() && req.user.role === 'admin') return next();
    res.status(403).send('Only admin can perform this action.');
};

// Check authentication status
app.get('/checkAuthStatus', (req, res) => {
    if (req.isAuthenticated()) {
        res.json(true);
    } else {
        res.json(false);
    }
});

// Add book endpoint (Admin only)
app.post('/addBook', isAdmin, upload.fields([{ name: 'cover' }, { name: 'bookFile' }]), async (req, res) => {
  try {
    let coverUrl = null;
    let pdfUrl = null;

    // Always use Cloudinary in production
    const useCloudinary = isCloudProduction;

    // Save to DB
    const { title, author, description } = req.body;
    // Parse genres (handle both stringified JSON and plain string)
    let genres = req.body.genres;
    if (genres) {
      try {
        genres = JSON.parse(genres);
        if (Array.isArray(genres)) {
          genres = genres.join(', ');
        }
      } catch (e) {
        // If not JSON, keep as is
      }
    } else {
      genres = '';
    }

    if (useCloudinary) {
      // Upload cover image to Cloudinary
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

      // Upload PDF to Cloudinary (resource_type: raw)
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
      // Fallback: save files locally
      const uploadDir = path.join(__dirname, 'uploads');
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



// Grant admin role (seeded admin only)
app.post('/users/:id/grant-admin', isSeedAdmin, async (req, res) => {
  const { id } = req.params;
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', id]);
  res.send(`User with ID ${id} granted admin role.`);
});

// Revoke admin role (seeded admin only)
app.post('/users/:id/revoke-admin', isSeedAdmin, async (req, res) => {
  const { id } = req.params;
  await pool.query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['user', id, 'admin']);
  res.send(`User with ID ${id} revoked admin role.`);
});


// Edit book endpoint (admin only)
app.put('/books/:id', isAdmin, async (req, res) => {
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

// Delete book endpoint (admin only)
app.delete('/books/:id', isAdmin, async (req, res) => {
  const bookId = req.params.id;

  const row = await pool.query('SELECT cover, file FROM books WHERE id = $1', [bookId]);
  if (row.rows.length === 0) return res.status(404).send('Book not found');

  const { cover, file } = row.rows[0];

  try {
    // Delete cover from Cloudinary
    if (cover && cover.includes('cloudinary.com')) {
      const publicId = cover.split('/').slice(-1)[0].split('.')[0];
      await cloudinary.uploader.destroy(`book-covers/${publicId}`);
    }

    // Delete PDF from Cloudinary (resource_type: raw)
    if (file && file.includes('cloudinary.com')) {
      const publicId = file.split('/').slice(-1)[0].split('.')[0];
      await cloudinary.uploader.destroy(`book-pdfs/${publicId}`, { resource_type: 'raw' });
    }

    // Delete DB record
    await pool.query('DELETE FROM books WHERE id = $1', [bookId]);
    res.send('Book deleted successfully');
  } catch (e) {
    console.error('Cloudinary delete error:', e.message);
    res.status(500).send('Failed to delete book files');
  }
});



// Endpoint to handle like action
app.post('/books/:id/like', isAuthenticated, async (req, res) => {
    const bookId = req.params.id;
    const userId = req.user.id;

    const row = await pool.query('SELECT action FROM likes WHERE userId = $1 AND bookId = $2', [userId, bookId]);
    if (row.rows.length > 0 && row.rows[0].action === 'like') {
        return res.status(400).send('You have already liked this book');
    }

    await pool.query('BEGIN');

    try {
        // If previously disliked, remove dislike
        if (row.rows.length > 0 && row.rows[0].action === 'dislike') {
            await pool.query('UPDATE books SET dislikes = MAX(dislikes - 1, 0) WHERE id = $1', [bookId]);
        }

        await pool.query('UPDATE books SET likes = likes + 1 WHERE id = $1', [bookId]);
        await pool.query('INSERT INTO likes (userId, bookId, action) VALUES ($1, $2, $3) ON CONFLICT (userId, bookId) DO UPDATE SET action = $3', [userId, bookId, 'like']);

        await pool.query('COMMIT');
        const bookResult = await pool.query('SELECT likes, dislikes FROM books WHERE id = $1', [bookId]);
        res.json(bookResult.rows[0]);
    } catch (e) {
        await pool.query('ROLLBACK');
        console.error('Error handling like action:', e);
        res.status(500).send('Failed to like book');
    }
});

// Endpoint to handle dislike action
app.post('/books/:id/dislike', isAuthenticated, async (req, res) => {
    const bookId = req.params.id;
    const userId = req.user.id;

    const row = await pool.query('SELECT action FROM likes WHERE userId = $1 AND bookId = $2', [userId, bookId]);
    if (row.rows.length > 0 && row.rows[0].action === 'dislike') {
        return res.status(400).send('You have already disliked this book');
    }

    await pool.query('BEGIN');

    try {
        // If previously liked, remove like
        if (row.rows.length > 0 && row.rows[0].action === 'like') {
            await pool.query('UPDATE books SET likes = MAX(likes - 1, 0) WHERE id = $1', [bookId]);
        }

        await pool.query('UPDATE books SET dislikes = dislikes + 1 WHERE id = $1', [bookId]);
        await pool.query('INSERT INTO likes (userId, bookId, action) VALUES ($1, $2, $3) ON CONFLICT (userId, bookId) DO UPDATE SET action = $3', [userId, bookId, 'dislike']);

        await pool.query('COMMIT');
        const bookResult = await pool.query('SELECT likes, dislikes FROM books WHERE id = $1', [bookId]);
        res.json(bookResult.rows[0]);
    } catch (e) {
        await pool.query('ROLLBACK');
        console.error('Error handling dislike action:', e);
        res.status(500).send('Failed to dislike book');
    }
});

// Search books
app.get('/books/search', async (req, res) => {
    const { query } = req.query;
    const result = await pool.query('SELECT * FROM books WHERE title ILIKE $1 OR author ILIKE $1', [`%${query}%`]);
    res.json(result.rows);
});

// Get all users (admin only)
app.get('/users', isAdmin, async (req, res) => {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
});

// Delete a specific user (admin only)
app.delete('/users/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [id, 'admin']);
    res.send('User deleted successfully.');
});

// Endpoint for recommended books
app.get("/recommendations", isAuthenticated, async (req, res) => {
    const userId = req.user.id;
    const currentBookId = req.query.bookId; // Get the current book ID from the query parameter

    if (!userId) {
        console.error("User ID is missing in the request.");
        return res.status(400).json({ error: "User ID is required" });
    }

    // Try external Flask service first (for local dev)
    try {
        const response = await axios.get(`http://127.0.0.1:5000/recommendations?user_id=${encodeURIComponent(userId)}`);
        if (response.data && response.data.recommendations) {
            // Exclude the current book and limit to 4 recommendations
            const filteredRecommendations = response.data.recommendations
                .filter((book) => book.id !== parseInt(currentBookId))
                .slice(0, 4);
            return res.json({ recommendations: filteredRecommendations });
        }
    } catch (error) {
        console.error("Flask service not available, running recommend.py directly.");

        // Detect platform and use correct Python executable
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

        const python = spawn(pythonCmd, [
            path.join(__dirname, 'recommend.py'),
            '--user_id', userId.toString()
        ]);

        let output = '';
        python.stdout.on('data', (data) => {
            output += data.toString();
        });

        python.stderr.on('data', (data) => {
            console.error('recommend.py error:', data.toString());
        });

        python.on('close', async (code) => {
            try {
                // Expect recommend.py to print a JSON string
                const result = JSON.parse(output);
                const filteredRecommendations = result.recommendations
                    .filter((book) => book.id !== parseInt(currentBookId))
                    .slice(0, 4);
                res.json({ recommendations: filteredRecommendations });
            } catch (err) {
                console.error('Error parsing recommend.py output:', err);

                // Fallback: query Postgres directly
                try {
                    const fallback = await pool.query(
                        'SELECT id, title, description, cover FROM books WHERE id != $1 LIMIT 4',
                        [currentBookId]
                    );
                    res.json({ recommendations: fallback.rows });
                } catch (dbErr) {
                    console.error("Error fetching fallback recommendations:", dbErr.message);
                    res.status(500).json({ error: "Error fetching recommendations" });
                }
            }
        });
    }
});

// Endpoint to fetch reviews for a book
app.get('/books/:id/reviews', async (req, res) => {
    const bookId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const result = await pool.query(
        `SELECT reviews.username, reviews.text, reviews.rating, users.profilePicture 
         FROM reviews 
         JOIN users ON reviews.userId = users.id 
         WHERE reviews.bookId = $1 
         LIMIT $2 OFFSET $3`,
        [bookId, limit, offset]
    );
    res.json(result.rows);
});

// Endpoint to submit a review for a book
app.post('/books/:id/reviews', isAuthenticated, async (req, res) => {
    const { text, rating } = req.body;
    const bookId = req.params.id;
    const userId = req.user.id;
    const username = req.user.username;

    if (!text || !rating || rating < 1 || rating > 5) {
        return res.status(400).send('Invalid review data');
    }

    await pool.query(
        'INSERT INTO reviews (bookId, userId, username, text, rating) VALUES ($1, $2, $3, $4, $5)',
        [bookId, userId, username, text, rating]
    );

    // Update the average rating for the book
    const row = await pool.query('SELECT AVG(rating) AS averageRating FROM reviews WHERE bookId = $1', [bookId]);
    const averageRating = row.rows[0]?.averageRating || 0;
    await pool.query('UPDATE books SET averageRating = $1 WHERE id = $2', [averageRating, bookId]);
    res.status(201).send({ message: 'Review added successfully', averageRating });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
// Local uploads folder (only for development)
if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  const uploadDir = path.join(__dirname, 'uploads');
  app.use('/uploads', express.static(uploadDir));
}


// Add centralized error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

// Endpoint to handle chat with AI
// This endpoint uses the Hugging Face API to interact with the Mistral-7B-Instruct model
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY; // Remove fallback key

app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;

  try {
    const response = await fetch('https://api-inference.huggingface.co/models/facebook/blenderbot-400M-distill', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: userMessage })
    });

    if (!response.ok) {
      console.error('Hugging Face API error:', response.status, response.statusText);
      return res.status(response.status).json({ reply: 'Oops! Something went wrong with the AI.' });
    }

    const data = await response.json();

    console.log('Hugging Face API response:', data);

    // Correctly extract the generated text
    const reply = data?.[0]?.generated_text || 'Sorry, I didn’t understand that.';

    res.json({ reply });
  } catch (error) {
    console.error('Hugging Face API error:', error.message);
    res.status(500).json({ reply: 'Oops! Something went wrong with the AI.' });
  }
});

// Download endpoint for book files (streams from Cloudinary or local)
app.get('/download/:bookId', async (req, res) => {
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
          // Try to get extension from URL or fallback to .pdf
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
        const filePath = path.join(__dirname, fileUrl);
        if (!fs.existsSync(filePath)) {
          console.warn(`Local file not found for bookId ${bookId}: ${filePath}`);
          return res.status(404).send('File not found');
        }
        res.download(filePath, `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
      }
    } catch (err) {
      res.status(500).send('Failed to fetch book');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});