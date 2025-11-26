/**
 * Des2 Library - Express Application Configuration
 * 
 * This file configures the Express.js application with:
 * - Middleware (CORS, body parsing, sessions)
 * - Passport authentication
 * - Route registration
 * - Static file serving
 * - Error handling
 * 
 * This is imported and used by server.js
 */

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const PgSession = require('connect-pg-simple')(session);

// ============================================
// IMPORT CONFIGURATIONS
// ============================================

// Database connection pool
const { pool } = require('./config/database');

// Passport authentication configuration
const passport = require('./config/passport');

// Environment variables and settings
const { 
  isProduction, 
  isDevelopment, 
  BACKEND_URL, 
  FRONTEND_URL, 
  allowedOrigins, 
  PORT, 
  SESSION_SECRET 
} = require('./config/environment');

// ============================================
// CREATE EXPRESS APP
// ============================================

const app = express();

// Log current environment for debugging
console.log(`🌍 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log(`🔗 Backend URL: ${BACKEND_URL}`);
console.log(`🔗 Frontend URL: ${FRONTEND_URL}`);

// ============================================
// CORS CONFIGURATION
// ============================================

/**
 * Configure Cross-Origin Resource Sharing (CORS)
 * Allows the frontend to make requests to the backend
 */
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) return callback(null, true);
    
    // Reject other origins
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true // Allow cookies to be sent
}));

// ============================================
// BASIC MIDDLEWARE
// ============================================

// Trust proxy - important for production (Render, Heroku, etc.)
app.set('trust proxy', 1);

// Parse JSON request bodies
app.use(express.json());

// Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// ============================================
// SESSION CONFIGURATION
// ============================================

/**
 * Configure session storage using PostgreSQL
 * Sessions are stored in database instead of memory
 * This allows sessions to persist across server restarts
 */
app.use(session({
  store: new PgSession({
    pool,                        // Use existing database pool
    tableName: 'session',        // Table name for sessions
    createTableIfMissing: true   // Auto-create table if needed
  }),
  secret: SESSION_SECRET,        // Secret key for signing session ID
  resave: false,                 // Don't save session if unmodified
  saveUninitialized: false,      // Don't create session until something stored
  cookie: {
    secure: isProduction,        // HTTPS only in production
    httpOnly: true,              // Prevent client-side JS from reading cookie
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: isProduction ? 'none' : 'lax' // CSRF protection
  },
  name: 'sessionId'              // Cookie name
}));

// ============================================
// PASSPORT AUTHENTICATION
// ============================================

// Initialize Passport for authentication
app.use(passport.initialize());

// Use sessions for persistent login
app.use(passport.session());

// ============================================
// STATIC FILES
// ============================================

// Serve frontend files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded files in development only
if (isDevelopment) {
  const uploadDir = path.join(__dirname, '../uploads');
  app.use('/uploads', express.static(uploadDir));
}

// ============================================
// IMPORT ROUTE HANDLERS
// ============================================

const authRoutes = require('./routes/auth');                  // Login, register, logout
const booksRoutes = require('./routes/books');                // Book CRUD operations
const reviewsRoutes = require('./routes/reviews');            // Book reviews
const usersRoutes = require('./routes/users');                // User management
const recommendationsRoutes = require('./routes/recommendations'); // AI recommendations
const newsletterRoutes = require('./routes/newsletter');      // Newsletter subscription
const downloadRoutes = require('./routes/download');          // File downloads
const chatbotRoutes = require('./routes/chatbot');           // AI chatbot
const analyticsRoutes = require('./routes/analytics');        // Admin analytics

// ============================================
// REGISTER ROUTES
// ============================================

/**
 * Route Registration
 * 
 * Base URL + Route Handler = Full Endpoint
 * 
 * Examples:
 * '/' + authRoutes (/login) = POST /login
 * '/books' + booksRoutes (/) = GET /books
 * '/users' + usersRoutes (/profile) = GET /users/profile
 */

app.use('/', authRoutes);                          // Auth endpoints at root level
app.use('/books', booksRoutes);                    // Book endpoints: /books/*
app.use('/books', reviewsRoutes);                  // Review endpoints: /books/:id/reviews
app.use('/users', usersRoutes);                    // User endpoints: /users/*
app.use('/recommendations', recommendationsRoutes); // Recommendation endpoints
app.use('/', newsletterRoutes);                    // Newsletter at root level
app.use('/download', downloadRoutes);              // Download endpoints: /download/*
app.use('/api', chatbotRoutes);                    // Chatbot endpoints: /api/*
app.use('/analytics', analyticsRoutes);            // Analytics endpoints: /analytics/*

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================

/**
 * Health check endpoint
 * Used to verify server is running
 */
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: isProduction ? 'production' : 'development'
  });
});

/**
 * Email service health check
 * Verifies SendGrid configuration
 */
app.get('/email-health', async (req, res) => {
  try {
    const isConfigured = !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
    
    res.json({
      sendgrid_configured: isConfigured,
      from_email: process.env.SENDGRID_FROM_EMAIL || 'Not configured',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Email service health check failed',
      details: error.message
    });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

/**
 * Global error handler
 * Catches any errors that weren't handled in routes
 */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

/**
 * 404 handler
 * Catches requests to non-existent routes
 */
app.use((req, res) => {
  res.status(404).send('Route not found');
});

// ============================================
// EXPORT APP
// ============================================

// Export configured app for use in server.js
module.exports = app;
