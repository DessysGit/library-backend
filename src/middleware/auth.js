const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { ADMIN_USERNAME, JWT_SECRET } = require('../config/environment');

// Resolve the current user from either session cookie or JWT Bearer token.
// Attaches the DB user to req.user and sets req.jwtAuthenticated = true if JWT was used.
async function resolveUser(req) {
  // Session already populated req.user
  if (req.isAuthenticated && req.isAuthenticated()) return true;

  // Try JWT fallback
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
      if (result.rows[0]) {
        req.user = result.rows[0];
        req.jwtAuthenticated = true;
        return true;
      }
    } catch (e) {
      // invalid/expired token - fall through
    }
  }
  return false;
}

// Check if user is authenticated
const isAuthenticated = async (req, res, next) => {
  if (await resolveUser(req)) return next();
  res.status(401).send('You must be logged in to perform this action.');
};

// Check if user is admin
const isAdmin = async (req, res, next) => {
  if (await resolveUser(req) && req.user.role === 'admin') return next();
  res.status(403).send('Only admin can perform this action.');
};

// Check if user is the seed admin
const isSeedAdmin = async (req, res, next) => {
  if (!await resolveUser(req)) {
    return res.status(401).send('Authentication required.');
  }

  const expectedAdminUsername = ADMIN_USERNAME;
  const isSeededAdmin = req.user.username === expectedAdminUsername;

  if (isSeededAdmin) return next();

  console.log(`Access denied - User "${req.user.username}" is not the seeded admin "${expectedAdminUsername}"`);
  res.status(403).send('Only the seeded admin can perform this action.');
};

module.exports = {
  isAuthenticated,
  isAdmin,
  isSeedAdmin
};
