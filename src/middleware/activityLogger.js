/**
 * Activity Logging Middleware
 * Automatically logs user and admin actions for monitoring and audit trails
 */

const { pool } = require('../config/database');

// Activity types
const ActivityTypes = {
  // User actions
  LOGIN: 'login',
  LOGOUT: 'logout',
  BORROW: 'borrow',
  RETURN: 'return',
  REVIEW: 'review',
  LIKE: 'like',
  DISLIKE: 'dislike',
  RESERVE: 'reserve',
  CANCEL_RESERVATION: 'cancel_reservation',
  REGISTER_EVENT: 'register_event',
  UPDATE_PROFILE: 'update_profile',
  
  // Admin actions
  ADMIN_LOGIN: 'admin_login',
  CREATE_BOOK: 'create_book',
  UPDATE_BOOK: 'update_book',
  DELETE_BOOK: 'delete_book',
  GRANT_ADMIN: 'grant_admin',
  REVOKE_ADMIN: 'revoke_admin',
  DELETE_USER: 'delete_user',
  WAIVE_FINE: 'waive_fine',
  ADJUST_FINE: 'adjust_fine',
  FULFILL_RESERVATION: 'fulfill_reservation',
  CANCEL_RESERVATION_ADMIN: 'cancel_reservation_admin',
  CREATE_EVENT: 'create_event',
  DELETE_EVENT: 'delete_event',
  
  // System events
  FAILED_LOGIN: 'failed_login',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity'
};

// Severity levels
const SeverityLevels = {
  POSITIVE: 'positive',
  NEUTRAL: 'neutral',
  SUSPICIOUS: 'suspicious',
  ABUSIVE: 'abusive'
};

/**
 * Log activity to database
 */
async function logActivity(userId, type, details = {}, severity = SeverityLevels.NEUTRAL) {
  try {
    await pool.query(
      `INSERT INTO user_activity ("userId", type, "bookId", "bookTitle", rating, text, severity, details, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        userId,
        type,
        details.bookId || null,
        details.bookTitle || null,
        details.rating || null,
        details.text || null,
        severity,
        JSON.stringify(details)
      ]
    );
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

/**
 * Middleware to log specific actions
 */
function logAction(type, severity = SeverityLevels.NEUTRAL, detailsExtractor = () => ({})) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return next();
      
      const details = detailsExtractor(req);
      await logActivity(userId, type, details, severity);
    } catch (error) {
      console.error('Activity logging error:', error);
    }
    next();
  };
}

/**
 * Detect suspicious activity patterns
 */
async function detectSuspiciousActivity(userId, actionType) {
  try {
    const recentActivities = await pool.query(
      `SELECT type, COUNT(*) as count, MAX("createdAt") as last_occurrence
       FROM user_activity
       WHERE "userId" = $1
         AND "createdAt" >= NOW() - INTERVAL '1 hour'
       GROUP BY type
       HAVING COUNT(*) > 20`,
      [userId]
    );
    
    if (recentActivities.rows.length > 0) {
      await logActivity(userId, ActivityTypes.SUSPICIOUS_ACTIVITY, {
        reason: 'High frequency actions detected',
        actions: recentActivities.rows
      }, SeverityLevels.SUSPICIOUS);
    }
  } catch (error) {
    console.error('Suspicious activity detection error:', error);
  }
}

module.exports = {
  ActivityTypes,
  SeverityLevels,
  logActivity,
  logAction,
  detectSuspiciousActivity
};