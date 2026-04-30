const express = require('express');
const argon2 = require('argon2');
const { verifyCsrfToken } = require('../utils/csrf');
const { createUser, getUserByEmail } = require('../utils/db');
const { authRateLimit } = require('../utils/auth');
const logger = require('../utils/logger');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pre-computed dummy hash used to ensure argon2.verify always runs on login,
// preventing timing-based account enumeration.
const DUMMY_HASH = argon2.hash('dummy-timing-equaliser', {
  type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('register', { error: null, csrfToken: res.locals.csrfToken });
});

router.post('/register', authRateLimit, verifyCsrfToken, async (req, res) => {
  const { email, password, confirmPassword } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || typeof confirmPassword !== 'string') {
    return res.status(400).render('register', { error: 'Invalid input.', csrfToken: res.locals.csrfToken });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).render('register', { error: 'Please enter a valid email address.', csrfToken: res.locals.csrfToken });
  }
  if (!password || password.length < 10) {
    return res.status(400).render('register', { error: 'Password must be at least 10 characters.', csrfToken: res.locals.csrfToken });
  }
  if (password !== confirmPassword) {
    return res.status(400).render('register', { error: 'Passwords do not match.', csrfToken: res.locals.csrfToken });
  }

  try {
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const userId = createUser(email, hash);
    req.session.userId = userId;
    req.session.userEmail = email.toLowerCase();
    logger.info(`New user registered: id=${userId}`);
    res.redirect('/profile');
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).render('register', { error: 'An account with that email already exists.', csrfToken: res.locals.csrfToken });
    }
    logger.error(`Register error: ${err.message}`);
    res.status(500).render('register', { error: 'Something went wrong. Please try again.', csrfToken: res.locals.csrfToken });
  }
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('login', { error: null, csrfToken: res.locals.csrfToken });
});

router.post('/login', authRateLimit, verifyCsrfToken, async (req, res) => {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).render('login', { error: 'Email and password are required.', csrfToken: res.locals.csrfToken });
  }
  if (!email || !password) {
    return res.status(400).render('login', { error: 'Email and password are required.', csrfToken: res.locals.csrfToken });
  }

  try {
    const user = getUserByEmail(email);
    const hashToVerify = user ? user.password_hash : await DUMMY_HASH;
    const valid = user && await argon2.verify(hashToVerify, password);

    if (!valid) {
      return res.status(401).render('login', { error: 'Incorrect email or password.', csrfToken: res.locals.csrfToken });
    }

    req.session.regenerate((err) => {
      if (err) {
        logger.error(`Session regenerate error: ${err.message}`);
        return res.status(500).render('login', { error: 'Something went wrong. Please try again.', csrfToken: res.locals.csrfToken });
      }
      req.session.userId = user.id;
      req.session.userEmail = user.email;
      logger.info(`User logged in: id=${user.id}`);
      res.redirect('/');
    });
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    res.status(500).render('login', { error: 'Something went wrong. Please try again.', csrfToken: res.locals.csrfToken });
  }
});

router.post('/logout', verifyCsrfToken, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
