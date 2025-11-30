/**
 * Des2 Library - Main Server Entry Point
 * 
 * This file is responsible for:
 * 1. Loading environment variables
 * 2. Initializing the database connection
 * 3. Setting up database tables
 * 4. Seeding the admin user
 * 5. Starting the Express server
 * 
 * The actual Express app configuration is in src/app.js
 */

// Load environment variables from .env file (quietly)
require('dotenv').config({ quiet: true });

// Try to load logger, fallback to console if winston not installed
let logger;
try {
  logger = require('./src/config/logger');
} catch (error) {
  console.log('⚠️  Winston not installed, using console logging');
  console.log('💡 Run "npm install winston" to enable structured logging');
  // Fallback logger
  logger = {
    info: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.log
  };
}

// Import the Express application
const app = require('./src/app');

// Import database functions
const { testConnection, ensureTables, closePool } = require('./src/config/database');

// Import service functions
const { seedAdmin, recalculateAverageRatings } = require('./src/services/databaseService');

// Get port from environment variables
const { PORT } = require('./src/config/environment');

// Track if server is already started
let serverStarted = false;

/**
 * Start the Express server
 */
function startServer(limited = false) {
  if (serverStarted) {
    logger.warn('Server already started, skipping duplicate start');
    return;
  }
  
  serverStarted = true;
  
  app.listen(PORT, () => {
    if (limited) {
      logger.warn(`Server is running on port ${PORT} (with limited database functionality)`);
    } else {
      logger.info(`Server is running on port ${PORT}`);
    }
    logger.info(`Local: http://localhost:${PORT}`);
  });
}

/**
 * Main startup function
 * Runs all initialization tasks before starting the server
 */
async function initialize() {
  try {
    logger.info('Starting server initialization...');
    
    // Test database connection silently
    await testConnection();
    logger.info('Database connection successful');
    
    // Create database tables if they don't exist
    await ensureTables();
    logger.info('Database tables verified');
    
    // Create default admin user if doesn't exist
    await seedAdmin();
    logger.info('Admin user verified');
    
    // Update average ratings for all books
    await recalculateAverageRatings();
    logger.info('Book ratings recalculated');
    
    // Start the Express server
    startServer(false);
    
  } catch (error) {
    // If setup fails, log error but still start server
    logger.error('Database setup failed', {
      error: error.message,
      code: error.code || 'Unknown error code'
    });
    logger.warn('Server will continue to run, but database functionality may be limited');
    
    // Start server anyway to allow debugging
    startServer(true);
  }
}

// Prevent server crash on unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason,
    promise: promise
  });
  // Don't exit the process, just log it
});

// Prevent server crash on uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', {
    error: err.message,
    stack: err.stack,
    code: err.code
  });
  
  // Don't exit the process for database connection errors
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
    logger.warn('Database connection error, but server will continue');
  } else {
    // For other critical errors, exit after logging
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully (SIGINT)...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully (SIGTERM)...');
  await closePool();
  process.exit(0);
});

// Start the initialization
initialize();
