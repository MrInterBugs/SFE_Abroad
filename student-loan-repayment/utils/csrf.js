const crypto = require('crypto');
const { hasCookieConsent } = require('./consent');

const CSRF_COOKIE = 'csrfToken';
const MUTATING_METHODS = ['POST', 'PUT', 'DELETE'];
const FORM_PATHS = new Set(['/login', '/register', '/profile', '/forgot-password', '/check-email', '/resend-confirmation']);

function hasNecessaryConsent(req) {
  return hasCookieConsent(req, 'necessary');
}

function shouldIssueCsrfToken(req) {
  return Boolean(
    req.cookies?.[CSRF_COOKIE] ||
    hasNecessaryConsent(req) ||
    req.session?.userId ||
    FORM_PATHS.has(req.path) ||
    req.path.startsWith('/reset-password/') ||
    req.path.startsWith('/confirm-email/')
  );
}

// Middleware to generate a CSRF token and store it in a cookie
const csrfProtection = (req, res, next) => {
  if (!shouldIssueCsrfToken(req)) {
    res.locals.csrfToken = '';
    return next();
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  const token = req.session.csrfToken;
  res.cookie(CSRF_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict' });
  res.locals.csrfToken = token;
  next();
};

// Middleware to verify CSRF token
const verifyCsrfToken = (req, res, next) => {
  if (MUTATING_METHODS.includes(req.method)) {
    const tokenFromClient = req.body.csrfToken || req.headers['x-csrf-token'];
    const tokenFromCookie = req.cookies?.[CSRF_COOKIE];
    const tokenFromSession = req.session?.csrfToken;

    if (
      tokenFromClient &&
      tokenFromCookie &&
      tokenFromSession &&
      tokenFromClient === tokenFromCookie &&
      tokenFromClient === tokenFromSession
    ) {
      return next();
    }
    return res.status(403).send('Invalid CSRF token');
  }
  next();
};

module.exports = { csrfProtection, verifyCsrfToken, hasNecessaryConsent, shouldIssueCsrfToken };
