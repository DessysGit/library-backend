const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { ADMIN_USERNAME, ADMIN_PASSWORD } = require('../config/environment');

// Seed admin user
async function seedAdmin() {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) AS count FROM users WHERE username = $1',
      [ADMIN_USERNAME]
    );

    if (parseInt(result.rows[0].count, 10) === 0) {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        [ADMIN_USERNAME, hashedPassword, 'admin']
      );
    }
  } catch (err) {
    console.error("❌ Error seeding admin user:", err);
  }
}

// Recalculate average ratings for all books
async function recalculateAverageRatings() {
  try {
    const booksResult = await pool.query('SELECT id FROM books');
    const books = booksResult.rows;
    let updated = 0;

    for (const book of books) {
      const row = await pool.query(
        'SELECT AVG(rating) AS avg_rating FROM reviews WHERE bookid = $1',
        [book.id]
      );
      const averageRating = parseFloat(row.rows[0]?.avg_rating) || 0;
      await pool.query(
        'UPDATE books SET averagerating = $1 WHERE id = $2',
        [averageRating, book.id]
      );
      if (averageRating > 0) updated++;
    }
  } catch (err) {
    console.error('❌ Error recalculating average ratings:', err.message);
  }
}

module.exports = {
  seedAdmin,
  recalculateAverageRatings
};
