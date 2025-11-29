/**
 * Logging Configuration using Winston
 * 
 * Provides structured logging with different levels and transports
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({ level, message, timestamp, stack, ...metadata }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(metadata).length > 0) {
      log += ` ${JSON.stringify(metadata)}`;
    }
    
    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

// Define log transports
const transports = [];

// Console transport (always enabled)
transports.push(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat
    )
  })
);

// File transports (only in production or if explicitly enabled)
const isProduction = process.env.NODE_ENV === 'production';
const enableFileLogging = process.env.ENABLE_FILE_LOGGING === 'true';

if (isProduction || enableFileLogging) {
  // Error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
  
  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
  
  // Debug log file (only in development with file logging)
  if (!isProduction && enableFileLogging) {
    transports.push(
      new winston.transports.File({
        filename: path.join(logsDir, 'debug.log'),
        level: 'debug',
        format: logFormat,
        maxsize: 5242880, // 5MB
        maxFiles: 3
      })
    );
  }
}

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: logFormat,
  transports: transports,
  exitOnError: false
});

// Create a stream object for Morgan (HTTP request logging)
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

// Helper methods for common logging patterns
logger.logRequest = (req, message, metadata = {}) => {
  logger.info(message, {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.user?.id,
    ...metadata
  });
};

logger.logError = (error, context = {}) => {
  logger.error(error.message, {
    error: error.name,
    stack: error.stack,
    ...context
  });
};

logger.logAuth = (username, action, success, metadata = {}) => {
  logger.info(`Authentication: ${action}`, {
    username,
    success,
    action,
    ...metadata
  });
};

logger.logDatabase = (query, duration, metadata = {}) => {
  if (process.env.LOG_SQL_QUERIES === 'true') {
    logger.debug('Database query', {
      query: query.substring(0, 200), // Truncate long queries
      duration: `${duration}ms`,
      ...metadata
    });
  }
};

logger.logEmail = (to, subject, success, metadata = {}) => {
  logger.info('Email sent', {
    to,
    subject,
    success,
    ...metadata
  });
};

logger.logFileUpload = (filename, size, success, metadata = {}) => {
  logger.info('File upload', {
    filename,
    size: `${(size / 1024).toFixed(2)}KB`,
    success,
    ...metadata
  });
};

// Log startup information
logger.info('Logger initialized', {
  level: logger.level,
  environment: process.env.NODE_ENV || 'development',
  fileLogging: isProduction || enableFileLogging
});

module.exports = logger;
