/**
 * HTTP Request Logging Middleware
 * 
 * Logs all HTTP requests with relevant information
 * Uses Winston logger for structured logging
 */

// Try to import logger, fallback to console if Winston not available
let logger;
try {
  logger = require('../config/logger');
} catch (error) {
  // Fallback to console if logger not available
  logger = {
    info: console.log,
    warn: console.warn,
    error: console.error
  };
}

/**
 * Request logger middleware
 * Logs details about each HTTP request
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Capture the original end function
  const originalEnd = res.end;
  
  // Override res.end to log when response is sent
  res.end = function(...args) {
    // Calculate response time
    const duration = Date.now() - start;
    
    // Determine log level based on status code
    const statusCode = res.statusCode;
    let logLevel = 'info';
    
    if (statusCode >= 500) {
      logLevel = 'error';
    } else if (statusCode >= 400) {
      logLevel = 'warn';
    }
    
    // Build log message
    const logData = {
      method: req.method,
      path: req.path,
      status: statusCode,
      time: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress
    };
    
    // Add user info if authenticated
    if (req.user) {
      logData.user = `${req.user.username} (${req.user.role})`;
    }
    
    // Add query params only if they exist and are not empty
    if (Object.keys(req.query).length > 0 && JSON.stringify(req.query) !== '{}') {
      logData.query = req.query;
    }
    
    // Create short, readable log message
    const userInfo = req.user ? ` [${req.user.username}]` : '';
    const message = `${req.method} ${req.path} ${statusCode} ${duration}ms${userInfo}`;
    
    // Log with appropriate level
    logger[logLevel](message, logData);
    
    // Call original end function
    originalEnd.apply(res, args);
  };
  
  next();
};

/**
 * Error logger middleware
 * Should be used after all routes
 * Logs errors that occur during request processing
 */
const errorLogger = (err, req, res, next) => {
  // Log the error with full context
  logger.error('Request error occurred', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.user?.id,
    body: req.body,
    params: req.params,
    query: req.query
  });
  
  // Pass error to next error handler
  next(err);
};

/**
 * Skip logging for certain paths (optional)
 * Useful for health checks, static assets, etc.
 */
const skipPaths = [
  '/health',
  '/favicon.ico',
  '/.well-known',           // Chrome DevTools
  '/current-user',          // Frequent polling
  '/profile'                // Frequent requests
];

const shouldSkipLogging = (req) => {
  return skipPaths.some(path => req.path.startsWith(path));
};

/**
 * Request logger with skip logic
 */
const requestLoggerWithSkip = (req, res, next) => {
  if (shouldSkipLogging(req)) {
    return next();
  }
  return requestLogger(req, res, next);
};

module.exports = {
  requestLogger,
  requestLoggerWithSkip,
  errorLogger
};
