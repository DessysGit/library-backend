const { ADMIN_USERNAME } = require('../config/environment');

// Check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).send('You must be logged in to perform this action.');
};

// Check if user is admin
const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  res.status(403).send('Only admin can perform this action.');
};

// Check if user is the seed admin
const isSeedAdmin = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).send('Authentication required.');
  }
  
  const expectedAdminUsername = ADMIN_USERNAME;
  const isSeededAdmin = req.user.username === expectedAdminUsername;
  
  if (isSeededAdmin) {
    return next();
  }
  
  console.log(`Access denied - User "${req.user.username}" is not the seeded admin "${expectedAdminUsername}"`);
  res.status(403).send('Only the seeded admin can perform this action.');
};

module.exports = {
  isAuthenticated,
  isAdmin,
  isSeedAdmin
};
