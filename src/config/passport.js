const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

// Configure Passport authentication strategy
passport.use(new LocalStrategy({
  usernameField: 'emailOrUsername',
  passwordField: 'password'
}, async (emailOrUsername, password, done) => {
  try {
    const isEmail = emailOrUsername.includes('@');
    const query = isEmail 
      ? 'SELECT * FROM users WHERE email = $1'
      : 'SELECT * FROM users WHERE username = $1';
      
    const result = await pool.query(query, [emailOrUsername]);
    const user = result.rows[0];
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return done(null, false, { message: 'Incorrect email/username or password.' });
    }
    
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    const user = result.rows[0];
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
