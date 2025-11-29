/**
 * File Upload Validation Utilities
 * 
 * Provides secure file validation for uploaded files
 */

const path = require('path');

/**
 * Allowed file types with their MIME types
 */
const ALLOWED_FILE_TYPES = {
  images: {
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    maxSize: 5 * 1024 * 1024, // 5MB
    description: 'Images (JPEG, PNG, WebP, GIF)'
  },
  documents: {
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
    maxSize: 50 * 1024 * 1024, // 50MB
    description: 'PDF documents'
  },
  covers: {
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    maxSize: 2 * 1024 * 1024, // 2MB for book covers
    description: 'Book covers (JPEG, PNG, WebP)'
  }
};

/**
 * Multer file filter for images (book covers)
 */
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = ALLOWED_FILE_TYPES.covers;
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();

  // Check both MIME type and extension
  const isValidMime = allowedTypes.mimeTypes.includes(mimeType);
  const isValidExt = allowedTypes.extensions.includes(ext);

  if (isValidMime && isValidExt) {
    return cb(null, true);
  }

  const error = new Error(
    `Invalid file type. Only ${allowedTypes.description} are allowed. ` +
    `Received: ${file.originalname} (${mimeType})`
  );
  error.code = 'INVALID_FILE_TYPE';
  cb(error, false);
};

/**
 * Multer file filter for PDFs (book files)
 */
const pdfFileFilter = (req, file, cb) => {
  const allowedTypes = ALLOWED_FILE_TYPES.documents;
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();

  const isValidMime = allowedTypes.mimeTypes.includes(mimeType);
  const isValidExt = allowedTypes.extensions.includes(ext);

  if (isValidMime && isValidExt) {
    return cb(null, true);
  }

  const error = new Error(
    `Invalid file type. Only ${allowedTypes.description} are allowed. ` +
    `Received: ${file.originalname} (${mimeType})`
  );
  error.code = 'INVALID_FILE_TYPE';
  cb(error, false);
};

/**
 * Combined file filter for both covers and PDFs
 */
const combinedFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();

  // Check if it's an image
  if (ALLOWED_FILE_TYPES.covers.mimeTypes.includes(mimeType) && 
      ALLOWED_FILE_TYPES.covers.extensions.includes(ext)) {
    return cb(null, true);
  }

  // Check if it's a PDF
  if (ALLOWED_FILE_TYPES.documents.mimeTypes.includes(mimeType) && 
      ALLOWED_FILE_TYPES.documents.extensions.includes(ext)) {
    return cb(null, true);
  }

  const error = new Error(
    'Invalid file type. Only book covers (JPEG, PNG, WebP) and PDF documents are allowed. ' +
    `Received: ${file.originalname} (${mimeType})`
  );
  error.code = 'INVALID_FILE_TYPE';
  cb(error, false);
};

/**
 * Validate file size after upload
 */
const validateFileSize = (file, type = 'images') => {
  const allowedTypes = ALLOWED_FILE_TYPES[type];
  if (!allowedTypes) {
    throw new Error(`Unknown file type: ${type}`);
  }

  if (file.size > allowedTypes.maxSize) {
    const maxSizeMB = (allowedTypes.maxSize / (1024 * 1024)).toFixed(1);
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File too large. Maximum size: ${maxSizeMB}MB. ` +
      `Your file: ${fileSizeMB}MB`
    );
  }

  return true;
};

/**
 * Sanitize filename to prevent directory traversal and other attacks
 */
const sanitizeFilename = (filename) => {
  // Remove any path components
  let sanitized = path.basename(filename);
  
  // Remove special characters except dots, dashes, and underscores
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Remove multiple dots to prevent extension spoofing
  sanitized = sanitized.replace(/\.{2,}/g, '.');
  
  // Ensure filename is not empty
  if (!sanitized || sanitized === '.') {
    sanitized = 'file_' + Date.now();
  }
  
  // Limit filename length
  const maxLength = 200;
  if (sanitized.length > maxLength) {
    const ext = path.extname(sanitized);
    const name = path.basename(sanitized, ext);
    sanitized = name.substring(0, maxLength - ext.length) + ext;
  }
  
  return sanitized;
};

/**
 * Get file extension from filename
 */
const getFileExtension = (filename) => {
  return path.extname(filename).toLowerCase();
};

/**
 * Check if file is an image
 */
const isImageFile = (file) => {
  const ext = getFileExtension(file.originalname || file.filename);
  const mimeType = file.mimetype?.toLowerCase();
  
  return ALLOWED_FILE_TYPES.images.extensions.includes(ext) ||
         ALLOWED_FILE_TYPES.images.mimeTypes.includes(mimeType);
};

/**
 * Check if file is a PDF
 */
const isPDFFile = (file) => {
  const ext = getFileExtension(file.originalname || file.filename);
  const mimeType = file.mimetype?.toLowerCase();
  
  return ALLOWED_FILE_TYPES.documents.extensions.includes(ext) ||
         ALLOWED_FILE_TYPES.documents.mimeTypes.includes(mimeType);
};

module.exports = {
  ALLOWED_FILE_TYPES,
  imageFileFilter,
  pdfFileFilter,
  combinedFileFilter,
  validateFileSize,
  sanitizeFilename,
  getFileExtension,
  isImageFile,
  isPDFFile
};
