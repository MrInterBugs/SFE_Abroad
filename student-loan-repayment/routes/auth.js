const express = require('express');
const argon2 = require('argon2');
const crypto = require('crypto');
const { verifyCsrfToken } = require('../utils/csrf');
const {
  createUser,
  getUserByEmail,
  confirmUserEmail,
  updateUserPassword,
  createAuthToken,
  consumeAuthToken,
  cleanupAuthTokens,
} = require('../utils/db');
const { authRateLimit } = require('../utils/auth');
const { sendEmailConfirmation, sendPasswordReset } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

// Pre-computed dummy hash used to ensure argon2.verify always runs on login,
// preventing timing-based account enumeration.
const DUMMY_HASH = argon2.hash('dummy-timing-equaliser', {
  type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
});

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function loginMessage(req) {
  if (req.query.confirmed) return 'Email confirmed. You can now sign in.';
  if (req.query.reset) return 'Password updated. You can now sign in.';
  return null;
}

async function sendConfirmationForUser(userId, email) {
  const token = newToken();
  createAuthToken(userId, 'email-confirmation', token, Date.now() + EMAIL_CONFIRM_TTL_MS);
  await sendEmailConfirmation(email, token);
  logger.info(`Email sent: type=email-confirmation userId=${userId}`);
}

async function sendPasswordResetForUser(user) {
  const token = newToken();
  createAuthToken(user.id, 'password-reset', token, Date.now() + PASSWORD_RESET_TTL_MS);
  await sendPasswordReset(user.email, token);
  logger.info(`Email sent: type=password-reset userId=${user.id}`);
}

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
    cleanupAuthTokens();
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const userId = createUser(email, hash);
    const normalizedEmail = email.toLowerCase();
    await sendConfirmationForUser(userId, normalizedEmail);
    req.session.pendingConfirmationEmail = normalizedEmail;
    logger.info(`New user registered: id=${userId}`);
    res.redirect('/check-email');
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).render('register', { error: 'An account with that email already exists.', csrfToken: res.locals.csrfToken });
    }
    logger.error(`Register error: ${err.message}`);
    res.status(500).render('register', { error: 'Something went wrong. Please try again.', csrfToken: res.locals.csrfToken });
  }
});

router.get('/check-email', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('check-email', {
    email: req.session.pendingConfirmationEmail || '',
    message: null,
    error: null,
    csrfToken: res.locals.csrfToken,
  });
});

router.post('/resend-confirmation', authRateLimit, verifyCsrfToken, async (req, res) => {
  const { email } = req.body;
  const message = 'If that email needs confirmation, a new link has been sent.';

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(200).render('check-email', { email: '', message, error: null, csrfToken: res.locals.csrfToken });
  }

  const normalizedEmail = email.toLowerCase();
  req.session.pendingConfirmationEmail = normalizedEmail;

  try {
    const user = getUserByEmail(normalizedEmail);
    if (user && !user.email_confirmed_at) {
      await sendConfirmationForUser(user.id, user.email);
    }
    res.status(200).render('check-email', { email: normalizedEmail, message, error: null, csrfToken: res.locals.csrfToken });
  } catch (err) {
    logger.error(`Confirmation resend error: ${err.message}`);
    res.status(500).render('check-email', { email: normalizedEmail, message: null, error: 'Something went wrong. Please try again.', csrfToken: res.locals.csrfToken });
  }
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('login', { error: null, message: loginMessage(req), csrfToken: res.locals.csrfToken });
});

router.post('/login', authRateLimit, verifyCsrfToken, async (req, res) => {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).render('login', { error: 'Email and password are required.', message: null, csrfToken: res.locals.csrfToken });
  }
  if (!email || !password) {
    return res.status(400).render('login', { error: 'Email and password are required.', message: null, csrfToken: res.locals.csrfToken });
  }

  try {
    const user = getUserByEmail(email);
    const hashToVerify = user ? user.password_hash : await DUMMY_HASH;
    let verified = false;
    try {
      verified = await argon2.verify(hashToVerify, password);
    } catch (verifyErr) {
      logger.warn(`Password verification failed: ${verifyErr.message}`);
    }
    const valid = Boolean(user && verified);

    if (!valid) {
      return res.status(401).render('login', { error: 'Incorrect email or password.', message: null, csrfToken: res.locals.csrfToken });
    }
    if (!user.email_confirmed_at) {
      req.session.pendingConfirmationEmail = user.email;
      return res.status(403).render('login', {
        error: null,
        message: null,
        unconfirmedEmailError: true,
        csrfToken: res.locals.csrfToken,
      });
    }

    req.session.regenerate((err) => {
      if (err) {
        logger.error(`Session regenerate error: ${err.message}`);
        return res.status(500).render('login', { error: 'Something went wrong. Please try again.', message: null, csrfToken: res.locals.csrfToken });
      }
      req.session.userId = user.id;
      req.session.userEmail = user.email;
      logger.info(`User logged in: id=${user.id}`);
      res.redirect('/');
    });
  } catch (err) {
    logger.error(`Login error: ${err.message}`);
    res.status(500).render('login', { error: 'Something went wrong. Please try again.', message: null, csrfToken: res.locals.csrfToken });
  }
});

router.get('/confirm-email/:token', (req, res) => {
  cleanupAuthTokens();
  const consumed = consumeAuthToken(req.params.token, 'email-confirmation');
  if (!consumed) {
    return res.status(400).render('login', {
      error: 'That confirmation link is invalid or has expired.',
      message: null,
      csrfToken: res.locals.csrfToken,
    });
  }

  confirmUserEmail(consumed.userId);
  if (req.session.pendingConfirmationEmail === consumed.email) delete req.session.pendingConfirmationEmail;
  logger.info(`Email confirmed: userId=${consumed.userId}`);
  res.redirect('/login?confirmed=1');
});

router.get('/forgot-password', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('forgot-password', { error: null, message: null, csrfToken: res.locals.csrfToken });
});

router.post('/forgot-password', authRateLimit, verifyCsrfToken, async (req, res) => {
  const { email } = req.body;
  const message = 'If that email has an account, a reset link has been sent.';

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(200).render('forgot-password', { error: null, message, csrfToken: res.locals.csrfToken });
  }

  try {
    cleanupAuthTokens();
    const user = getUserByEmail(email);
    if (user) {
      await sendPasswordResetForUser(user);
    }
    res.status(200).render('forgot-password', { error: null, message, csrfToken: res.locals.csrfToken });
  } catch (err) {
    logger.error(`Password reset request error: ${err.message}`);
    res.status(500).render('forgot-password', { error: 'Something went wrong. Please try again.', message: null, csrfToken: res.locals.csrfToken });
  }
});

router.get('/reset-password/:token', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('reset-password', { error: null, token: req.params.token, csrfToken: res.locals.csrfToken });
});

router.post('/reset-password/:token', authRateLimit, verifyCsrfToken, async (req, res) => {
  const { password, confirmPassword } = req.body;

  if (typeof password !== 'string' || typeof confirmPassword !== 'string') {
    return res.status(400).render('reset-password', { error: 'Invalid input.', token: req.params.token, csrfToken: res.locals.csrfToken });
  }
  if (!password || password.length < 10) {
    return res.status(400).render('reset-password', { error: 'Password must be at least 10 characters.', token: req.params.token, csrfToken: res.locals.csrfToken });
  }
  if (password !== confirmPassword) {
    return res.status(400).render('reset-password', { error: 'Passwords do not match.', token: req.params.token, csrfToken: res.locals.csrfToken });
  }

  try {
    cleanupAuthTokens();
    const consumed = consumeAuthToken(req.params.token, 'password-reset');
    if (!consumed) {
      return res.status(400).render('reset-password', { error: 'That reset link is invalid or has expired.', token: req.params.token, csrfToken: res.locals.csrfToken });
    }

    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    updateUserPassword(consumed.userId, hash);
    logger.info(`Password reset: userId=${consumed.userId}`);
    res.redirect('/login?reset=1');
  } catch (err) {
    logger.error(`Password reset error: ${err.message}`);
    res.status(500).render('reset-password', { error: 'Something went wrong. Please try again.', token: req.params.token, csrfToken: res.locals.csrfToken });
  }
});

router.post('/logout', verifyCsrfToken, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
