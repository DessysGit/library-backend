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

// Load environment variables from .env file
require('dotenv').config();

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
    console.log('⚠️  Server already started, skipping duplicate start');
    return;
  }
  
  serverStarted = true;
  
  app.listen(PORT, () => {
    if (limited) {
      console.log(`🚀 Server is running on port ${PORT} (with limited database functionality)`);
    } else {
      console.log(`🚀 Server is running on port ${PORT}`);
    }
    console.log(`📍 Local: http://localhost:${PORT}`);
  });
}

/**
 * Main startup function
 * Runs all initialization tasks before starting the server
 */
async function initialize() {
  try {
    // Step 1: Test database connection
    console.log('🔄 Testing database connection...');
    await testConnection();
    
    // Step 2: Create database tables if they don't exist
    console.log('🔄 Ensuring database tables...');
    await ensureTables();
    
    // Step 3: Create default admin user if doesn't exist
    console.log('🔄 Seeding admin user...');
    await seedAdmin();
    
    // Step 4: Update average ratings for all books
    console.log('🔄 Recalculating average ratings...');
    await recalculateAverageRatings();
    
    console.log('✅ Database setup completed successfully');
    
    // Step 5: Start the Express server
    startServer(false);
    
  } catch (error) {
    // If setup fails, log error but still start server
    console.error('❌ Database setup failed:', error.message);
    console.error('   Error details:', error.code || 'Unknown error code');
    console.log('⚠️  Server will continue to run, but database functionality may be limited');
    
    // Start server anyway to allow debugging
    startServer(true);
  }
}

// Prevent server crash on unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
  console.error('   Promise:', promise);
  // Don't exit the process, just log it
});

// Prevent server crash on uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  console.error('   Stack:', err.stack);
  // Don't exit the process for database connection errors
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
    console.log('⚠️  Database connection error, but server will continue');
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await closePool();
  process.exit(0);
});

// Start the initialization
initialize();
