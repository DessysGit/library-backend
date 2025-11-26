/**
 * Cloudinary Helpers
 * Functions to delete files from Cloudinary
 */

const cloudinary = require('../config/cloudinary');

/**
 * Extract public ID from Cloudinary URL
 * @param {string} url - Full Cloudinary URL
 * @param {string} folder - Folder name (e.g., 'book-covers', 'book-pdfs')
 * @returns {string|null} - Public ID or null if not a Cloudinary URL
 */
function extractPublicId(url, folder) {
  if (!url || !url.includes('cloudinary.com')) {
    return null;
  }
  
  try {
    const urlParts = url.split('/');
    const publicIdWithExt = urlParts[urlParts.length - 1];
    const publicId = publicIdWithExt.split('.')[0];
    return `${folder}/${publicId}`;
  } catch (error) {
    console.error('Error extracting public ID:', error);
    return null;
  }
}

/**
 * Delete cover image from Cloudinary
 * @param {string} coverUrl - Full Cloudinary URL of the cover
 * @returns {Promise<boolean>} - True if deleted successfully
 */
async function deleteCoverFromCloudinary(coverUrl) {
  const publicId = extractPublicId(coverUrl, 'book-covers');
  
  if (!publicId) {
    return false;
  }
  
  try {
    await cloudinary.uploader.destroy(publicId);
    console.log(`✅ Deleted cover from Cloudinary: ${publicId}`);
    return true;
  } catch (error) {
    console.error('⚠️ Could not delete cover from Cloudinary:', error.message);
    return false;
  }
}

/**
 * Delete PDF from Cloudinary
 * @param {string} pdfUrl - Full Cloudinary URL of the PDF
 * @returns {Promise<boolean>} - True if deleted successfully
 */
async function deletePdfFromCloudinary(pdfUrl) {
  const publicId = extractPublicId(pdfUrl, 'book-pdfs');
  
  if (!publicId) {
    return false;
  }
  
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    console.log(`✅ Deleted PDF from Cloudinary: ${publicId}`);
    return true;
  } catch (error) {
    console.error('⚠️ Could not delete PDF from Cloudinary:', error.message);
    return false;
  }
}

module.exports = {
  deleteCoverFromCloudinary,
  deletePdfFromCloudinary,
  extractPublicId
};
