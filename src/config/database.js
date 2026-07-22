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

      // ── Tesano Community Library Tables ──────────────────────────────────
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS memberships (
          id SERIAL PRIMARY KEY,
          "userId" INTEGER NOT NULL,
          "membershipType" TEXT NOT NULL DEFAULT 'standard',
          "startDate" TIMESTAMP NOT NULL DEFAULT NOW(),
          "endDate" TIMESTAMP,
          status TEXT NOT NULL DEFAULT 'active',
          "libraryCardNumber" TEXT UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS borrowed_books (
          id SERIAL PRIMARY KEY,
          "userId" INTEGER NOT NULL,
          "bookId" INTEGER NOT NULL,
          "borrowDate" TIMESTAMP NOT NULL DEFAULT NOW(),
          "dueDate" TIMESTAMP NOT NULL,
          "returnDate" TIMESTAMP,
          status TEXT NOT NULL DEFAULT 'borrowed',
          fine DECIMAL(10,2) DEFAULT 0,
          FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY ("bookId") REFERENCES books(id) ON DELETE CASCADE
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS events (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          "eventDate" TIMESTAMP NOT NULL,
          location TEXT,
          "maxAttendees" INTEGER,
          "createdBy" INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY ("createdBy") REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS event_registrations (
          id SERIAL PRIMARY KEY,
          "eventId" INTEGER NOT NULL,
          "userId" INTEGER NOT NULL,
          "registeredAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE("eventId", "userId"),
          FOREIGN KEY ("eventId") REFERENCES events(id) ON DELETE CASCADE,
          FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Add phone and address columns to users if not present
      try {
        await client.query(`
          ALTER TABLE users 
          ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '',
          ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '',
          ADD COLUMN IF NOT EXISTS "isLibraryMember" BOOLEAN DEFAULT FALSE
        `);
      } catch (e) {
        // Columns may already exist - that's fine
      }
      
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
let isShuttingDown = false;

process.on('SIGINT', async () => {
  if (!isShuttingDown) {
    isShuttingDown = true;
    await closePool();
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  if (!isShuttingDown) {
    isShuttingDown = true;
    await closePool();
    process.exit(0);
  }
});

module.exports = {
  pool,
  directPool,
  testConnection,
  ensureTables,
  closePool
};
