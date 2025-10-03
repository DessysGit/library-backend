const sgMail = require('@sendgrid/mail');
const { BACKEND_URL, FRONTEND_URL } = require('../config/environment');

// Configure SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Email template for verification
function createVerificationEmailTemplate(verificationUrl, username = 'User') {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email - Des2 Library</title>
    <style>
      body {
        font-family: 'Arial', sans-serif;
        line-height: 1.6;
        color: #333;
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        background-color: #f4f4f4;
      }
      .container {
        background-color: #ffffff;
        padding: 30px;
        border-radius: 10px;
        box-shadow: 0 0 20px rgba(0,0,0,0.1);
      }
      .header {
        text-align: center;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 2px solid #1DB954;
      }
      .logo {
        color: #1DB954;
        font-size: 28px;
        font-weight: bold;
        margin: 0;
      }
      .verify-button {
        display: inline-block;
        background: linear-gradient(45deg, #1DB954, #17a647);
        color: white;
        padding: 15px 30px;
        text-decoration: none;
        border-radius: 8px;
        font-weight: bold;
        font-size: 16px;
        margin: 20px 0;
      }
      .url-text {
        background-color: #f8f9fa;
        padding: 15px;
        border-radius: 5px;
        border-left: 4px solid #1DB954;
        word-break: break-all;
        font-family: 'Courier New', monospace;
        font-size: 14px;
        color: #666;
        margin: 15px 0;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1 class="logo">Des2 Library</h1>
        <p>Your Gateway to Infinite Knowledge</p>
      </div>
      <div class="content">
        <h2 style="color: #1DB954;">Welcome to Des2 Library!</h2>
        <p>Hello ${username},</p>
        <p>Thank you for joining our community! Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" class="verify-button">Verify My Email</a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <div class="url-text">${verificationUrl}</div>
        <p><strong>This link will expire in 24 hours.</strong></p>
      </div>
      <div style="margin-top: 40px; text-align: center; font-size: 14px; color: #666;">
        <p>If you didn't create an account, please ignore this email.</p>
        <p>&copy; 2025 Des2 Library. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
  `;
}

// Email template for password reset
function createPasswordResetEmailTemplate(resetUrl, username = 'User') {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password - Des2 Library</title>
    <style>
      body {
        font-family: 'Arial', sans-serif;
        line-height: 1.6;
        color: #333;
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        background-color: #f4f4f4;
      }
      .container {
        background-color: #ffffff;
        padding: 30px;
        border-radius: 10px;
        box-shadow: 0 0 20px rgba(0,0,0,0.1);
      }
      .header {
        text-align: center;
        margin-bottom: 30px;
        padding-bottom: 20px;
        border-bottom: 2px solid #dc3545;
      }
      .reset-button {
        display: inline-block;
        background: linear-gradient(45deg, #dc3545, #c82333);
        color: white;
        padding: 15px 30px;
        text-decoration: none;
        border-radius: 8px;
        font-weight: bold;
        font-size: 16px;
        margin: 20px 0;
      }
      .url-text {
        background-color: #f8f9fa;
        padding: 15px;
        border-radius: 5px;
        border-left: 4px solid #dc3545;
        word-break: break-all;
        font-family: 'Courier New', monospace;
        font-size: 14px;
        color: #666;
        margin: 15px 0;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1 style="color: #dc3545; margin: 0;">Des2 Library</h1>
        <p>Password Reset Request</p>
      </div>
      <div class="content">
        <h2 style="color: #dc3545;">Reset Your Password</h2>
        <p>Hello ${username},</p>
        <p>We received a request to reset your password. Click the button below to reset it:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" class="reset-button">Reset My Password</a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <div class="url-text">${resetUrl}</div>
        <p><strong>This link will expire in 1 hour.</strong></p>
        <p>If you didn't request a password reset, you can safely ignore this email.</p>
      </div>
      <div style="margin-top: 40px; text-align: center; font-size: 14px; color: #666;">
        <p>&copy; 2025 Des2 Library. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
  `;
}

// Send verification email
async function sendVerificationEmail(email, token, username = 'User') {
  const verificationUrl = `${BACKEND_URL}/verify-email?token=${token}`;
  
  console.log(`📧 Sending verification email to ${email}`);
  console.log(`🔗 Verification URL: ${verificationUrl}`);
  
  const msg = {
    to: email,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL,
      name: 'Des2 Library'
    },
    subject: 'Verify Your Email - Des2 Library',
    html: createVerificationEmailTemplate(verificationUrl, username),
    text: `Welcome to Des2 Library!\n\nHello ${username},\n\nPlease verify your email: ${verificationUrl}\n\nThis link expires in 24 hours.`,
    categories: ['email-verification']
  };

  try {
    const response = await sgMail.send(msg);
    console.log('✅ Verification email sent successfully:', response[0].statusCode);
    return true;
  } catch (error) {
    console.error('❌ SendGrid error:', error);
    if (error.response) {
      console.error('SendGrid response body:', error.response.body);
    }
    return false;
  }
}

// Send password reset email
async function sendPasswordResetEmail(email, token, username = 'User') {
  const resetUrl = `${FRONTEND_URL}/reset-password.html?token=${token}`;
  
  console.log(`📧 Sending password reset email to ${email}`);
  console.log(`🔗 Reset URL: ${resetUrl}`);
  
  const msg = {
    to: email,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL,
      name: 'Des2 Library'
    },
    subject: 'Reset Your Password - Des2 Library',
    html: createPasswordResetEmailTemplate(resetUrl, username),
    text: `Password Reset Request\n\nHello ${username},\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
    categories: ['password-reset']
  };

  try {
    const response = await sgMail.send(msg);
    console.log('✅ Password reset email sent successfully:', response[0].statusCode);
    return true;
  } catch (error) {
    console.error('❌ SendGrid error:', error);
    if (error.response) {
      console.error('SendGrid response body:', error.response.body);
    }
    return false;
  }
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail
};
