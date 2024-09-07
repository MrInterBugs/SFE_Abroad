const crypto = require('crypto');

// Middleware to generate a CSRF token and store it in a cookie
const csrfProtection = (req, res, next) => {
  const token = req.cookies.csrfToken || crypto.randomBytes(32).toString('hex');
  res.cookie('csrfToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.locals.csrfToken = token;  // Make it accessible in templates
  next();
};

// Middleware to verify CSRF token
const verifyCsrfToken = (req, res, next) => {
  const tokenFromClient = req.body.csrfToken || req.headers['x-csrf-token'];
  const tokenFromCookie = req.cookies.csrfToken;

  if (tokenFromClient && tokenFromCookie && tokenFromClient === tokenFromCookie) {
    next();
  } else {
    res.status(403).send('Invalid CSRF token');
  }
};

module.exports = { csrfProtection, verifyCsrfToken };
