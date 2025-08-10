const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Path to the SQLite database file
const dbPath = path.join(__dirname, 'library.db');

// Connect to the SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to the SQLite database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// Create Users table if it does not exist
const createUsersTable = () => {
    const query = `
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT,
            email TEXT,
            profilePicture TEXT,
            favoriteGenres TEXT,
            favoriteAuthors TEXT,
            favoriteBooks TEXT
        )
    `;
    db.run(query, (err) => {
        if (err) {
            console.error('Error creating Users table:', err.message);
        } else {
            console.log('Users table created successfully or already exists.');
        }
    });
};

// Create Books table if it does not exist
const createBooksTable = () => {
    const query = `
        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            author TEXT,
            description TEXT,
            genres TEXT,
            cover TEXT,
            file TEXT,
            likes INTEGER DEFAULT 0,
            dislikes INTEGER DEFAULT 0,
            averageRating REAL DEFAULT 0
        )
    `;
    db.run(query, (err) => {
        if (err) {
            console.error('Error creating Books table:', err.message);
        } else {
            console.log('Books table created successfully or already exists.');
        }
    });
};

// Add missing columns to existing tables if they don't exist
const addMissingColumns = () => {
    db.run(`ALTER TABLE books ADD COLUMN averageRating REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding averageRating column to books table:', err.message);
        } else if (!err) {
            console.log('averageRating column added to books table.');
        }
    });

    db.run(`ALTER TABLE reviews ADD COLUMN rating INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('Error adding rating column to reviews table:', err.message);
        } else if (!err) {
            console.log('rating column added to reviews table.');
        }
    });
};

// Recalculate average ratings for all books
const recalculateAverageRatings = () => {
    db.all('SELECT id FROM books', [], (err, books) => {
        if (err) {
            console.error('Error fetching books for recalculating average ratings:', err.message);
            return;
        }

        books.forEach((book) => {
            const bookId = book.id;
            // TODO: Refactor to reduce nesting (code smell: >4 levels deep)
            db.get(
                'SELECT AVG(rating) AS averageRating FROM reviews WHERE bookId = ?',
                [bookId],
                (err, row) => {
                    if (err) {
                        console.error(`Error calculating average rating for book ID ${bookId}:`, err.message);
                        return;
                    }
                    const averageRating = row?.averageRating || 0;
                    db.run(
                        'UPDATE books SET averageRating = ? WHERE id = ?',
                        [averageRating, bookId],
                        (err) => {
                            if (err) {
                                console.error(`Error updating average rating for book ID ${bookId}:`, err.message);
                            } else {
                                console.log(`Average rating updated for book ID ${bookId}: ${averageRating}`);
                            }
                        }
                    );
                }
            );
        });
    });
};

// Initialize the database by creating the necessary tables and adding missing columns
const initializeDatabase = () => {
    createUsersTable();
    createBooksTable();
    addMissingColumns();
    recalculateAverageRatings();
};

// Execute the initialization function
initializeDatabase();

module.exports = db;