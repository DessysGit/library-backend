const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const passport = require('../config/passport');
const { pool } = require('../config/database');
const { loginLimiter } = require('../middleware/rateLimiter');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const { FRONTEND_URL } = require('../config/environment');

// Register route
router.post('/register', [
  body('username').isLength({ min: 3 }).withMessage('Username must be at least 3 characters long')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
  body('email').isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, password } = req.body;

  try {
    const emailCheck = await pool.query(
      'SELECT COUNT(*) AS count FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (parseInt(emailCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({ 
        errors: [{ msg: 'An account with this email already exists' }] 
      });
    }

    const usernameCheck = await pool.query(
      'SELECT COUNT(*) AS count FROM users WHERE username = $1',
      [username]
    );

    if (parseInt(usernameCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({ 
        errors: [{ msg: 'This username is already taken' }] 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      'INSERT INTO users (username, email, password, role, "emailVerificationToken", "emailVerificationExpires", "isEmailVerified") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [username, email.toLowerCase(), hashedPassword, 'user', emailVerificationToken, emailVerificationExpires, false]
    );

    const emailSent = await sendVerificationEmail(email, emailVerificationToken, username);

    if (!emailSent) {
      return res.status(500).json({ 
        errors: [{ msg: 'Account created but verification email could not be sent.' }],
        requiresVerification: true
      });
    }

    res.status(201).json({ 
      message: 'Registration successful! Please check your email and click the verification link.',
      requiresVerification: true 
    });

  } catch (err) {
    console.error('Error registering user:', err);
    res.status(500).json({ 
      errors: [{ msg: 'Registration failed. Please try again later.' }] 
    });
  }
});

// Login route
router.post('/login', loginLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) { return next(err); }
    if (!user) { 
      return res.status(401).json({ 
        error: 'Invalid credentials',
        message: 'Incorrect email/username or password'
      }); 
    }
    
    if (!user.isEmailVerified) {
      return res.status(403).json({ 
        error: 'Email not verified',
        message: 'Please verify your email address before logging in.',
        canResendVerification: true,
        userEmail: user.email
      });
    }

    req.logIn(user, (err) => {
      if (err) { return next(err); }
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        profilePicture: user.profilePicture
      });
    });
  })(req, res, next);
});

// Logout route
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.send('Logged out successfully.');
  });
});

// Verify email
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send('Verification token is required');
  }

  try {
    const result = await pool.query(
      'SELECT id, email, username FROM users WHERE "emailVerificationToken" = $1 AND "emailVerificationExpires" > NOW() AND "isEmailVerified" = FALSE',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
            <h2 style="color: #dc3545;">Invalid or Expired Token</h2>
            <p>The verification link is invalid, expired, or already used.</p>
            <a href="${FRONTEND_URL}" style="color: #1DB954;">Return to Login</a>
          </body>
        </html>
      `);
    }

    const user = result.rows[0];

    await pool.query(
      'UPDATE users SET "isEmailVerified" = TRUE, "emailVerificationToken" = NULL, "emailVerificationExpires" = NULL WHERE id = $1',
      [user.id]
    );

    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
          <h2 style="color: #1DB954;">Email Verified Successfully!</h2>
          <p>Welcome to Des2 Library, ${user.username}!</p>
          <p>You can now log in to your account.</p>
          <a href="${FRONTEND_URL}" style="display: inline-block; background-color: #1DB954; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin-top: 20px;">Go to Login</a>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('Error verifying email:', err);
    res.status(500).send('Email verification failed');
  }
});

// Resend verification email
router.post('/resend-verification', [
  body('email').isEmail().withMessage('Please provide a valid email address').normalizeEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email } = req.body;

  try {
    const result = await pool.query(
      'SELECT id, username, "isEmailVerified" FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Email not found',
        message: 'No account found with this email address.'
      });
    }

    const user = result.rows[0];

    if (user.isEmailVerified) {
      return res.status(400).json({ 
        error: 'Already verified',
        message: 'This email is already verified. You can log in to your account.'
      });
    }

    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      'UPDATE users SET "emailVerificationToken" = $1, "emailVerificationExpires" = $2 WHERE email = $3',
      [emailVerificationToken, emailVerificationExpires, email.toLowerCase()]
    );

    const emailSent = await sendVerificationEmail(email, emailVerificationToken, user.username);

    if (!emailSent) {
      return res.status(500).json({ 
        error: 'Email send failed',
        message: 'Could not send verification email. Please try again later.'
      });
    }

    res.json({ 
      message: 'Verification email sent successfully! Please check your inbox.'
    });

  } catch (err) {
    console.error('Error resending verification email:', err);
    res.status(500).json({ 
      error: 'Server error',
      message: 'Could not resend verification email.'
    });
  }
});

// Request password reset
router.post('/request-password-reset', [
  body('email').isEmail().withMessage('Please provide a valid email address').normalizeEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email } = req.body;

  try {
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      'UPDATE users SET "passwordResetToken" = $1, "passwordResetExpires" = $2 WHERE id = $3',
      [resetToken, resetTokenExpires, user.id]
    );

    const emailSent = await sendPasswordResetEmail(email, resetToken, user.username);

    if (!emailSent) {
      return res.status(500).json({ 
        error: 'Failed to send reset email'
      });
    }

    res.json({ 
      message: 'If an account with that email exists, a password reset link has been sent.'
    });

  } catch (err) {
    console.error('Error requesting password reset:', err);
    res.status(500).json({ 
      error: 'Server error'
    });
  }
});

// Validate reset token
router.get('/validate-reset-token/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      'SELECT id, "passwordResetExpires" FROM users WHERE "passwordResetToken" = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ 
        valid: false,
        message: 'Invalid or expired reset token'
      });
    }

    const user = result.rows[0];
    const tokenExpires = new Date(user.passwordResetExpires);
    const now = new Date();

    if (tokenExpires <= now) {
      return res.status(400).json({ 
        valid: false,
        message: 'This reset link has expired.'
      });
    }

    res.json({ valid: true });

  } catch (err) {
    console.error('Error validating reset token:', err);
    res.status(500).json({ 
      valid: false,
      message: 'Error validating token'
    });
  }
});

// Reset password
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { token, newPassword } = req.body;

  try {
    const result = await pool.query(
      'SELECT id, "passwordResetExpires" FROM users WHERE "passwordResetToken" = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid token'
      });
    }

    const user = result.rows[0];
    const expirationTime = new Date(user.passwordResetExpires);
    const currentTime = new Date();
    
    if (expirationTime <= currentTime) {
      return res.status(400).json({ 
        error: 'Expired token'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.query(
      'UPDATE users SET password = $1, "passwordResetToken" = NULL, "passwordResetExpires" = NULL WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.json({ 
      message: 'Password has been reset successfully.'
    });

  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ 
      error: 'Server error'
    });
  }
});

// Current user
router.get('/current-user', async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const result = await pool.query(
        'SELECT id, username, role, profilepicture as "profilePicture" FROM users WHERE id = $1',
        [req.user.id]
      );
      const freshUser = result.rows[0];
      // Ensure profilePicture is always returned (even if null)
      if (!freshUser.profilePicture) {
        freshUser.profilePicture = '';
      }
      res.json(freshUser);
    } catch (err) {
      console.error('Error fetching current user:', err);
      // Return basic user info with empty profilePicture on error
      res.json({
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        profilePicture: req.user.profilePicture || ''
      });
    }
  } else {
    res.status(401).send('Not authenticated');
  }
});

// Check auth status
router.get('/checkAuthStatus', (req, res) => {
  res.json(req.isAuthenticated());
});

module.exports = router;
