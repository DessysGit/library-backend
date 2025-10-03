require('dotenv').config();

// Environment detection
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.HEROKU;
const isDevelopment = !isProduction;

// URL configuration
const getBaseUrl = () => {
  if (isProduction) {
    return process.env.BACKEND_URL || 'https://library-backend-j90e.onrender.com';
  } else {
    return `http://localhost:${process.env.PORT || 3000}`;
  }
};

const getFrontendUrl = () => {
  if (isProduction) {
    return process.env.FRONTEND_URL || 'https://strong-paletas-464b32.netlify.app';
  } else {
    return process.env.FRONTEND_DEV_URL || 'http://localhost:3000';
  }
};

const BACKEND_URL = getBaseUrl();
const FRONTEND_URL = getFrontendUrl();

// CORS allowed origins
const allowedOrigins = [
  'http://localhost:3000',
  'https://strong-paletas-464b32.netlify.app'
];

// Cloudinary usage detection
const isCloudProduction = isProduction || process.env.FORCE_CLOUDINARY === 'true';

module.exports = {
  isProduction,
  isDevelopment,
  BACKEND_URL,
  FRONTEND_URL,
  allowedOrigins,
  isCloudProduction,
  PORT: process.env.PORT || 3000,
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-key',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'adminpassword2003'
};
