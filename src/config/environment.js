require('dotenv').config({ quiet: true });

// Environment detection
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.HEROKU;
const isDevelopment = !isProduction;

// Validate required environment variables
const requiredEnvVars = [
  'SESSION_SECRET',
  'ADMIN_PASSWORD'
];

// Only check in production
if (isProduction) {
  requiredEnvVars.push('BACKEND_URL', 'FRONTEND_URL', 'DATABASE_URL');
}

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  console.error('💡 Please check your .env file or environment configuration');
  if (!isProduction) {
    console.log('⚠️  Running in development mode with default values');
  }
}

// URL configuration
const getBaseUrl = () => {
  if (isProduction) {
    if (!process.env.BACKEND_URL) {
      throw new Error('BACKEND_URL must be set in production environment');
    }
    return process.env.BACKEND_URL;
  } else {
    return process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
  }
};

const getFrontendUrl = () => {
  if (isProduction) {
    if (!process.env.FRONTEND_URL) {
      throw new Error('FRONTEND_URL must be set in production environment');
    }
    return process.env.FRONTEND_URL;
  } else {
    return process.env.FRONTEND_URL || 'http://localhost:3000';
  }
};

const BACKEND_URL = getBaseUrl();
const FRONTEND_URL = getFrontendUrl();

// CORS allowed origins - dynamically build from environment
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

// Add production URLs if they exist
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}
if (process.env.BACKEND_URL) {
  allowedOrigins.push(process.env.BACKEND_URL);
}

// Cloudinary usage detection
const isCloudProduction = isProduction || process.env.FORCE_CLOUDINARY === 'true';

// Validate critical settings
if (process.env.SESSION_SECRET === 'dev-secret-key' && isProduction) {
  throw new Error('Cannot use default SESSION_SECRET in production!');
}

if (process.env.ADMIN_PASSWORD === 'adminpassword2003' && isProduction) {
  throw new Error('Cannot use default ADMIN_PASSWORD in production!');
}

module.exports = {
  isProduction,
  isDevelopment,
  BACKEND_URL,
  FRONTEND_URL,
  allowedOrigins,
  isCloudProduction,
  PORT: process.env.PORT || 3000,
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-key-change-this',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change-this-password'
};
