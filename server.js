const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const passport = require('passport');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const LocalStrategy = require('passport-local').Strategy;
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { spawn } = require('child_process');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
app.set('trust proxy', 1); // Trust first proxy (required for rate-limit & session cookies on Render)
app.disable('x-powered-by'); // Hide Express version info
const PORT = 3000;

app.use('/chatbot', express.static(path.join(__dirname, 'chatbot')));


// Middleware setup
app.use(express.urlencoded({ extended: true }));
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigin = isProduction
    ? 'https://strong-paletas-464b32.netlify.app'
    : 'http://localhost:3000';

app.use(cors({
    origin: allowedOrigin,
    credentials: true
}));
app.use(bodyParser.json());

// Ensure SESSION_SECRET is always set for express-session
const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-key'; // fallback for development

// Initialize Passport and session
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }),
    cookie: {
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax'
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// Set up SQLite database
let db = new sqlite3.Database(path.join(__dirname, 'library.db'), (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the SQLite database.');
});

// Create Users table
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT,
    email TEXT,
    profilePicture TEXT,
    favoriteGenres TEXT,
    favoriteAuthors TEXT,
    favoriteBooks TEXT
)`);

// Create Books table
db.run(`CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    author TEXT,
    description TEXT,
    genres TEXT,
    cover TEXT,
    file TEXT
)`);

// Add likes and dislikes columns to the Books table if they don't exist
db.run(`ALTER TABLE books ADD COLUMN likes INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding likes column:', err.message);
    }
});
db.run(`ALTER TABLE books ADD COLUMN dislikes INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding dislikes column:', err.message);
    }
});

// Add summary column to the Books table if it doesn't exist
db.run(`ALTER TABLE books ADD COLUMN summary TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding summary column:', err.message);
    }
});

// Create Likes table to track user likes and dislikes
db.run(`CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    bookId INTEGER,
    action TEXT,
    UNIQUE(userId, bookId)
)`);

// Create Reviews table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bookId INTEGER,
    userId INTEGER,
    username TEXT,
    text TEXT,
    rating INTEGER,
    FOREIGN KEY(bookId) REFERENCES books(id),
    FOREIGN KEY(userId) REFERENCES users(id)
)`);

// Seed admin user if not exists
const seedAdmin = async () => {
    db.get('SELECT COUNT(*) AS count FROM users WHERE username = ?', ['admin'], async (err, row) => {
        if (err) {
            console.error('Error checking admin existence:', err.message);
        } else if (row.count === 0) {
            const hashedPassword = await bcrypt.hash('adminpassword', 10);
            db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', hashedPassword, 'admin'], (err) => {
                if (err) {
                    console.log('Error creating admin:', err.message);
                } else {
                    console.log('Admin user seeded successfully.');
                }
            });
        } else {
            console.log('Admin user already exists.');
        }
    });
};
seedAdmin();

// Recalculate averageRating for all books
const recalculateAverageRatings = () => {
    db.all('SELECT id FROM books', [], (err, books) => {
        if (err) {
            console.error('Error fetching books for recalculating average ratings:', err.message);
            return;
        }

        books.forEach((book) => {
            db.get(
                'SELECT AVG(rating) AS averageRating FROM reviews WHERE bookId = ?',
                [book.id],
                (err, row) => {
                    if (err) {
                        console.error(`Error calculating average rating for book ID ${book.id}:`, err.message);
                        return;
                    }

                    const averageRating = row?.averageRating || 0;
                    db.run(
                        'UPDATE books SET averageRating = ? WHERE id = ?',
                        [averageRating, book.id],
                        (err) => {
                            if (err) {
                                console.error(`Error updating average rating for book ID ${book.id}:`, err.message);
                            }
                        }
                    );
                }
            );
        });
    });
};

// Call the function during server startup
recalculateAverageRatings();

// Configure Passport.js for authentication
passport.use(new LocalStrategy((username, password, done) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return done(err);
        if (!user || !bcrypt.compareSync(password, user.password)) return done(null, false, { message: 'Incorrect username or password.' });
        return done(null, user);
    });
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
        if (err) return done(err);
        done(null, user);
    });
});

// Middleware to parse JSON
app.use(express.json());

// Create the uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Authentication check middleware
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    res.status(401).send('You must be logged in to perform this action.');
};

// Verify the user role is set correctly
app.use((req, res, next) => {
    if (req.isAuthenticated()) {
        db.get('SELECT role FROM users WHERE id = ?', [req.user.id], (err, user) => {
            if (user) {
                req.user.role = user.role; // Ensure the role is set correctly
            }
            next();
        });
    } else {
        next();
    }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); // Save file with its original name
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 50000000 } }); // 50 MB limit

// Profile picture upload endpoint
app.post('/upload-profile-picture', upload.single('profilePicture'), (req, res) => {
    const profilePictureUrl = `/uploads/${req.file.filename}`;
    const userId = req.user.id; // Assuming user ID is available in the request

    // Update the user's profile picture URL in the database
    db.run('UPDATE users SET profilePicture = ? WHERE id = ?', [profilePictureUrl, userId], function (err) {
        if (err) {
            return res.status(500).send(err.message);
        }
        res.json({ profilePictureUrl });
    });
});

// Endpoint to get user profile
app.get('/profile', isAuthenticated, (req, res) => {
    const { id } = req.user;
    db.get('SELECT username, email, role, profilePicture, favoriteGenres, favoriteAuthors, favoriteBooks FROM users WHERE id = ?', [id], (err, user) => {
        if (err) {
            res.status(500).send(err.message);
            return;
        }
        res.json(user);
    });
});

// Endpoint to update user profile
app.post('/updateProfile', isAuthenticated, (req, res) => {
    const { id } = req.user;
    const { email, password, favoriteGenres, favoriteAuthors, favoriteBooks } = req.body;

    let updateQuery = 'UPDATE users SET email = ?, favoriteGenres = ?, favoriteAuthors = ?, favoriteBooks = ?';
    let params = [email, favoriteGenres, favoriteAuthors, favoriteBooks, id];

    if (password) {
        const hashedPassword = bcrypt.hashSync(password, 10);
        updateQuery = 'UPDATE users SET email = ?, password = ?, favoriteGenres = ?, favoriteAuthors = ?, favoriteBooks = ?';
        params = [email, hashedPassword, favoriteGenres, favoriteAuthors, favoriteBooks, id];
    }

    db.run(updateQuery + ' WHERE id = ?', params, function (err) {
        if (err) {
            res.status(500).send(err.message);
            return;
        }
        res.send('Profile updated successfully.');
    });
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
app.get('/books', (req, res) => {
    const title = req.query.title || "";
    const author = req.query.author || "";
    const genre = req.query.genre || "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const isAdmin = req.isAuthenticated() && req.user.role === 'admin';

    let query = 'SELECT * FROM books WHERE title LIKE ? AND author LIKE ?';
    let params = [`%${title}%`, `%${author}%`];

    if (genre) {
        query += ' AND genres LIKE ?';
        params.push(`%${genre}%`);
    }
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).send('Failed to fetch books');
        } else {
            db.get('SELECT COUNT(*) AS total FROM books WHERE title LIKE ? AND author LIKE ?', [`%${title}%`, `%${author}%`], (err, count) => {
                if (err) {
                    res.status(500).send('Failed to fetch book count');
                } else {
                    const booksWithAdminFlag = rows.map(book => ({
                        ...book,
                        isAdmin: isAdmin
                    }));

                    // Fetch total ratings for each book
                    const bookIds = booksWithAdminFlag.map(book => book.id);
                    const placeholders = bookIds.map(() => '?').join(',');
                    db.all(
                        `SELECT bookId, COUNT(*) AS totalRatings FROM reviews WHERE bookId IN (${placeholders}) GROUP BY bookId`,
                        bookIds,
                        (err, ratings) => {
                            if (err) {
                                console.error('Error fetching total ratings:', err.message);
                                res.status(500).send('Failed to fetch total ratings');
                            } else {
                                const ratingsMap = Object.fromEntries(ratings.map(r => [r.bookId, r.totalRatings]));
                                booksWithAdminFlag.forEach(book => {
                                    book.totalRatings = ratingsMap[book.id] || 0;
                                });
                                res.json({ books: booksWithAdminFlag, total: count.total });
                            }
                        }
                    );
                }
            });
        }
    });
});

// Endpoint to fetch book details by ID
app.get('/books/:id', (req, res) => {
    const bookId = req.params.id;
    db.get(
        'SELECT id, title, author, genres, summary, description, cover, file, averageRating, likes, dislikes FROM books WHERE id = ?',
        [bookId],
        (err, row) => {
            if (err) {
                console.error('Error fetching book details:', err);
                return res.status(500).send('Failed to fetch book details');
            }
            if (!row) {
                return res.status(404).send('Book not found');
            }

            // Add full paths for cover and file
            row.cover = `/uploads/${row.cover}`;
            row.file = `/uploads/${row.file}`;
            res.json(row);
        }
    );
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

    // Find the smallest available ID
    db.get('SELECT MIN(id + 1) AS nextId FROM users WHERE (id + 1) NOT IN (SELECT id FROM users)', [], (err, row) => {
        if (err) {
            console.error('Error finding next available ID:', err);
            return res.status(500).send('Failed to register user');
        }

        const nextId = row?.nextId || 1; // Default to 1 if no users exist

        // Insert the new user with the calculated ID
        db.run(
            'INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, "user")',
            [nextId, username, hashedPassword],
            (err) => {
                if (err) {
                    console.error('Error registering user:', err);
                    return res.status(400).send(err.message);
                }
                res.send('User registered successfully.');
            }
        );
    });
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

// Add book endpoint (admin only)
app.post('/addBook', isAdmin, upload.fields([{ name: 'bookCover', maxCount: 1 }, { name: 'bookFile', maxCount: 1 }]), (req, res) => {
    const { title, author, description } = req.body;
    const genres = JSON.parse(req.body.genres);
    const cover = req.files['bookCover'] ? req.files['bookCover'][0].originalname : null;
    const file = req.files['bookFile'] ? req.files['bookFile'][0].originalname : null;
    const genresString = genres.join(",");

    if (!title || !author || !description || !genresString) {
        res.status(400).send('Missing required fields');
        return;
    }

    // Find the smallest available ID
    db.get('SELECT MIN(id + 1) AS nextId FROM books WHERE (id + 1) NOT IN (SELECT id FROM books)', [], (err, row) => {
        if (err) {
            console.error('Error finding next available ID:', err);
            return res.status(500).send('Failed to add book');
        }

        const nextId = row?.nextId || 1; // Default to 1 if no books exist

        // Insert the new book with the calculated ID
        db.run(
            'INSERT INTO books (id, title, author, description, genres, cover, file) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [nextId, title, author, description, genresString, cover, file],
            function (err) {
                if (err) {
                    console.error('Error adding book:', err);
                    return res.status(500).send('Failed to add book');
                }
                res.status(200).send('Book added successfully');
            }
        );
    });
});

// Endpoint to download a book file
app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);

    if (fs.existsSync(filePath)) {
        res.download(filePath, filename); // Serve the file with its original name
    } else {
        res.status(404).send('File not found');
    }
});

// Grant admin role (seeded admin only)
app.post('/users/:id/grant-admin', isSeedAdmin, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE users SET role = "admin" WHERE id = ?', id, function (err) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }
        res.send(`User with ID ${id} granted admin role.`);
    });
});

// Revoke admin role (seeded admin only)
app.post('/users/:id/revoke-admin', isSeedAdmin, (req, res) => {
    const { id } = req.params;
    db.run('UPDATE users SET role = "user" WHERE id = ? AND role = "admin"', id, function (err) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }
        res.send(`User with ID ${id} revoked admin role.`);
    });
});

// Edit book endpoint (admin only)
app.put('/books/:id', isAdmin, (req, res) => {
    const bookId = req.params.id;
    const { title, author, genres, summary, description } = req.body;
    db.run(
        'UPDATE books SET title = ?, author = ?, genres = ?, summary = ?, description = ? WHERE id = ?',
        [title, author, genres, summary, description, bookId],
        function (err) {
            if (err) {
                console.error('Error editing book:', err);
                res.status(500).send('Failed to edit book');
            } else {
                db.get('SELECT * FROM books WHERE id = ?', [bookId], (err, updatedBook) => {
                    if (err) {
                        console.error('Error fetching updated book:', err);
                        res.status(500).send('Failed to fetch updated book');
                    } else {
                        res.json(updatedBook); // Return updated book details
                    }
                });
            }
        }
    );
});

// Delete book endpoint (admin only)
app.delete('/books/:id', isAdmin, (req, res) => {
    const bookId = req.params.id;

    // Fetch book details to get the file names
    db.get('SELECT cover, file FROM books WHERE id = ?', [bookId], (err, row) => {
        if (err) {
            console.error('Error fetching book details:', err);
            return res.status(500).send('Failed to fetch book details');
        }

        const { cover, file } = row;
        const coverPath = path.join(__dirname, 'uploads', cover);
        const filePath = path.join(__dirname, 'uploads', file);

        // Delete the book record from the database
        db.run('DELETE FROM books WHERE id = ?', [bookId], function (err) {
            if (err) {
                console.error('Error deleting book:', err);
                return res.status(500).send('Failed to delete book');
            }

            // Reset the auto-increment counter for the books table
            db.run('DELETE FROM sqlite_sequence WHERE name = "books"', (err) => {
                if (err) {
                    console.error('Error resetting books auto-increment counter:', err);
                }
            });

            // Delete the cover image file
            if (fs.existsSync(coverPath)) {
                fs.unlink(coverPath, (err) => {
                    if (err) {
                        console.error('Error deleting cover image:', err);
                    }
                });
            }

            // Delete the book file
            if (fs.existsSync(filePath)) {
                fs.unlink(filePath, (err) => {
                    if (err) {
                        console.error('Error deleting book file:', err);
                    }
                });
            }

            res.status(200).send('Book deleted successfully');
        });
    });
});

// Endpoint to handle like action
app.post('/books/:id/like', isAuthenticated, (req, res) => {
    const bookId = req.params.id;
    const userId = req.user.id;

    db.serialize(() => {
        db.get('SELECT action FROM likes WHERE userId = ? AND bookId = ?', [userId, bookId], (err, row) => {
            if (err) {
                console.error('Error checking like status:', err);
                return res.status(500).send('Failed to like book');
            }

            if (row && row.action === 'like') {
                return res.status(400).send('You have already liked this book');
            }

            db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    console.error('Transaction begin error:', err);
                    return res.status(500).send('Transaction error');
                }

                const updateDislikes = row && row.action === 'dislike'
                    ? 'UPDATE books SET dislikes = MAX(dislikes - 1, 0) WHERE id = ?'
                    : null;

                const queries = [
                    updateDislikes && [updateDislikes, [bookId]],
                    ['UPDATE books SET likes = likes + 1 WHERE id = ?', [bookId]],
                    ['INSERT OR REPLACE INTO likes (userId, bookId, action) VALUES (?, ?, ?)', [userId, bookId, 'like']]
                ].filter(Boolean);

                let completed = 0;

                queries.forEach(([query, params]) => {
                    db.run(query, params, (err) => {
                        if (err) {
                            console.error('Error executing query:', query, err);
                            return db.run('ROLLBACK', () => res.status(500).send('Failed to like book'));
                        }

                        completed++;
                        if (completed === queries.length) {
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    console.error('Commit failed:', err);
                                    return res.status(500).send('Commit error');
                                }

                                db.get('SELECT likes, dislikes FROM books WHERE id = ?', [bookId], (err, row) => {
                                    if (err) {
                                        console.error('Error fetching book data:', err);
                                        return res.status(500).send('Error fetching book data');
                                    }
                                    res.json(row);
                                });
                            });
                        }
                    });
                });
            });
        });
    });
});

// Endpoint to handle dislike action
app.post('/books/:id/dislike', isAuthenticated, (req, res) => {
    const bookId = req.params.id;
    const userId = req.user.id;

    db.serialize(() => {
        db.get('SELECT action FROM likes WHERE userId = ? AND bookId = ?', [userId, bookId], (err, row) => {
            if (err) {
                console.error('Error checking dislike status:', err);
                return res.status(500).send('Failed to dislike book');
            }

            if (row && row.action === 'dislike') {
                return res.status(400).send('You have already disliked this book');
            }

            db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    console.error('Transaction begin error:', err);
                    return res.status(500).send('Transaction error');
                }

                const updateLikes = row && row.action === 'like'
                    ? 'UPDATE books SET likes = MAX(likes - 1, 0) WHERE id = ?'
                    : null;

                const queries = [
                    updateLikes && [updateLikes, [bookId]],
                    ['UPDATE books SET dislikes = dislikes + 1 WHERE id = ?', [bookId]],
                    ['INSERT OR REPLACE INTO likes (userId, bookId, action) VALUES (?, ?, ?)', [userId, bookId, 'dislike']]
                ].filter(Boolean);

                let completed = 0;

                queries.forEach(([query, params]) => {
                    db.run(query, params, (err) => {
                        if (err) {
                            console.error('Error executing query:', query, err);
                            return db.run('ROLLBACK', () => res.status(500).send('Failed to dislike book'));
                        }

                        completed++;
                        if (completed === queries.length) {
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    console.error('Commit failed:', err);
                                    return res.status(500).send('Commit error');
                                }

                                db.get('SELECT likes, dislikes FROM books WHERE id = ?', [bookId], (err, row) => {
                                    if (err) {
                                        console.error('Error fetching book data:', err);
                                        return res.status(500).send('Error fetching book data');
                                    }
                                    res.json(row);
                                });
                            });
                        }
                    });
                });
            });
        });
    });
});

// Search books
app.get('/books/search', (req, res) => {
    const { query } = req.query;
    db.all('SELECT * FROM books WHERE title LIKE ? OR author LIKE ?', [`%${query}%`, `%${query}%`], (err, rows) => {
        if (err) {
            res.status(400).send(err.message);
            return;
        }
        res.json(rows);
    });
});

// Get all users (admin only)
app.get('/users', isAdmin, (req, res) => {
    db.all('SELECT * FROM users', [], (err, rows) => {
        if (err) {
            res.status(400).send(err.message);
            return;
        }
        res.json(rows);
    });
});

// Delete a specific user (admin only)
app.delete('/users/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM users WHERE id = ? AND role != "admin"', id, function (err) {
        if (err) {
            res.status(400).send(err.message);
            return;
        }

        // Reset the auto-increment counter for the users table
        db.run('DELETE FROM sqlite_sequence WHERE name = "users"', (err) => {
            if (err) {
                console.error('Error resetting users auto-increment counter:', err);
            }
        });

        res.send('User deleted successfully.');
    });
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

        python.on('close', (code) => {
            try {
                // Expect recommend.py to print a JSON string
                const result = JSON.parse(output);
                const filteredRecommendations = result.recommendations
                    .filter((book) => book.id !== parseInt(currentBookId))
                    .slice(0, 4);
                res.json({ recommendations: filteredRecommendations });
            } catch (err) {
                console.error('Error parsing recommend.py output:', err);
                // Fallback: Return up to 4 sample recommendations excluding the current book
                db.all(
                    'SELECT id, title, description, cover FROM books WHERE id != ? LIMIT 4',
                    [currentBookId],
                    (err, rows) => {
                        if (err) {
                            console.error("Error fetching fallback recommendations:", err.message);
                            return res.status(500).json({ error: "Error fetching recommendations" });
                        }
                        res.json({ recommendations: rows });
                    }
                );
            }
        });
    }
});

// Endpoint to fetch reviews for a book
app.get('/books/:id/reviews', (req, res) => {
    const bookId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    db.all(
        `SELECT reviews.username, reviews.text, reviews.rating, users.profilePicture 
         FROM reviews 
         JOIN users ON reviews.userId = users.id 
         WHERE reviews.bookId = ? 
         LIMIT ? OFFSET ?`,
        [bookId, limit, offset],
        (err, rows) => {
            if (err) {
                console.error('Error fetching reviews:', err);
                return res.status(500).send('Failed to fetch reviews');
            }
            res.json(rows);
        }
    );
});

// Endpoint to submit a review for a book
app.post('/books/:id/reviews', isAuthenticated, (req, res) => {
    const { text, rating } = req.body;
    const bookId = req.params.id;
    const userId = req.user.id;
    const username = req.user.username;

    if (!text || !rating || rating < 1 || rating > 5) {
        return res.status(400).send('Invalid review data');
    }

    db.run(
        'INSERT INTO reviews (bookId, userId, username, text, rating) VALUES (?, ?, ?, ?, ?)',
        [bookId, userId, username, text, rating],
        function (err) {
            if (err) {
                console.error('Error adding review:', err);
                return res.status(500).send('Failed to add review');
            }

            // Update the average rating for the book
            db.get(
                'SELECT AVG(rating) AS averageRating FROM reviews WHERE bookId = ?',
                [bookId],
                (err, row) => {
                    if (err) {
                        console.error('Error calculating average rating:', err);
                        return res.status(500).send('Failed to update average rating');
                    }

                    const averageRating = row?.averageRating || 0;
                    db.run(
                        'UPDATE books SET averageRating = ? WHERE id = ?',
                        [averageRating, bookId],
                        (err) => {
                            if (err) {
                                console.error('Error updating average rating:', err);
                                return res.status(500).send('Failed to update average rating');
                            }
                            res.status(201).send({ message: 'Review added successfully', averageRating });
                        }
                    );
                }
            );
        }
    );
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// NOTE: For production, run behind HTTPS and set NODE_ENV=production