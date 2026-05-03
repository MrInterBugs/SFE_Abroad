const crypto = require('crypto');

const CSRF_COOKIE = 'csrfToken';
const MUTATING_METHODS = ['POST', 'PUT', 'DELETE'];
const FORM_PATHS = new Set(['/login', '/register', '/profile']);

function hasNecessaryConsent(req) {
  const raw = req.cookies?.CookieConsent;
  if (!raw) return false;
  return decodeURIComponent(raw).includes('necessary:true');
}

function shouldIssueCsrfToken(req) {
  return Boolean(
    req.cookies?.[CSRF_COOKIE] ||
    hasNecessaryConsent(req) ||
    req.session?.userId ||
    FORM_PATHS.has(req.path)
  );
}

// Middleware to generate a CSRF token and store it in a cookie
const csrfProtection = (req, res, next) => {
  if (!shouldIssueCsrfToken(req)) {
    res.locals.csrfToken = '';
    return next();
  }

  const token = req.cookies[CSRF_COOKIE] || crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict' });
  res.locals.csrfToken = token;
  next();
};

// Middleware to verify CSRF token
const verifyCsrfToken = (req, res, next) => {
  if (MUTATING_METHODS.includes(req.method)) {
    const tokenFromClient = req.body.csrfToken || req.headers['x-csrf-token'];
    const tokenFromCookie = req.cookies?.[CSRF_COOKIE];

    if (tokenFromClient && tokenFromCookie && tokenFromClient === tokenFromCookie) {
      return next();
    }
    return res.status(403).send('Invalid CSRF token');
  }
  next();
};

module.exports = { csrfProtection, verifyCsrfToken, hasNecessaryConsent, shouldIssueCsrfToken };
