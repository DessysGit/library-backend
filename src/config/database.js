/**
 * Database Configuration
 * 
 * This file handles:
 * - PostgreSQL connection pool setup with dual connection strategy
 * - Connection testing with retry logic
 * - Database table creation using direct connection
 * - Error handling for database operations
 */

const { Pool } = require('pg');

// Import logger
let logger;
try {
  logger = require('./logger');
} catch (error) {
  // Fallback to console if logger not available
  logger = {
    info: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.log
  };
}

// ============================================
// DATABASE CONNECTION POOLS
// ============================================

/**
 * Main pool for regular queries (uses pooler for better performance)
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

/**
 * Direct connection pool for DDL operations (CREATE TABLE, ALTER, etc.)
 * Supabase pooler has limitations with long-running operations
 */
const directPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000,
  statement_timeout: 60000,  // 60 seconds for DDL operations
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

/**
 * Handle unexpected database errors
 */
pool.on("error", (err) => {
  logger.error('Database pool error', { error: err.message });
});

directPool.on("error", (err) => {
  logger.error('Direct pool error', { error: err.message });
});

// ============================================
// CONNECTION TESTING
// ============================================

async function testConnection() {
  const maxRetries = 3;
  let retries = 0;
  
  while (retries < maxRetries) {
    let client;
    try {
      client = await pool.connect();
      const result = await client.query('SELECT NOW()');      
      client.release();
      return true;
    } catch (err) {
      if (client) {
        try { client.release(); } catch (e) { /* ignore */ }
      }
      
      retries++;
      logger.error('Database connection failed', { 
        attempt: retries, 
        maxRetries, 
        error: err.message 
      });
      
      if (retries === maxRetries) {
        throw err;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// ============================================
// TABLE CREATION
// ============================================

async function ensureTables() {
  const maxRetries = 3;
  let retries = 0;
  
  while (retries < maxRetries) {
    let client;
    try {
      // Use direct pool for DDL operations
      client = await directPool.connect();
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          "profilePicture" TEXT DEFAULT '',
          "favoriteGenres" TEXT DEFAULT '',
          "favoriteAuthors" TEXT DEFAULT '',
          "favoriteBooks" TEXT DEFAULT '',
          "isEmailVerified" BOOLEAN DEFAULT FALSE,
          "emailVerificationToken" TEXT,
          "emailVerificationExpires" TIMESTAMP,
          "passwordResetToken" TEXT,
          "passwordResetExpires" TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await client.query(`
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
          averagerating FLOAT DEFAULT 0
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS likes (
          id SERIAL PRIMARY KEY,
          "userId" INTEGER,
          "bookId" INTEGER,
          action TEXT,
          UNIQUE("userId", "bookId")
        )
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS reviews (
          id SERIAL PRIMARY KEY,
          "bookId" INTEGER,
          "userId" INTEGER,
          username TEXT,
          text TEXT,
          rating INTEGER
        )
      `);
      
      client.release();
      return;
      
    } catch (err) {
      if (client) {
        try { 
          client.release(true);
        } catch (e) { 
          // Ignore release errors
        }
      }
      
      retries++;
      logger.error('Table creation failed', { 
        attempt: retries, 
        maxRetries, 
        error: err.message 
      });
      
      // If it's a "relation already exists" error, that's actually fine
      if (err.message.includes('already exists')) {
        logger.info('Database tables already exist');
        return;
      }
      
      if (retries === maxRetries) {
        throw err;
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

/**
 * Close both database pools on application shutdown
 */
async function closePool() {
  try {
    logger.info('Closing database connections');
    await Promise.all([
      pool.end(),
      directPool.end()
    ]);
    logger.info('Database connections closed successfully');
  } catch (err) {
    logger.error('Error closing database pools', { error: err.message });
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closePool();
  process.exit(0);
});

module.exports = {
  pool,
  directPool,
  testConnection,
  ensureTables,
  closePool
};
