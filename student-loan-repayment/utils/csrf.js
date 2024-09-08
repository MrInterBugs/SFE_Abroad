const crypto = require('crypto');

// Middleware to generate a CSRF token and store it in a cookie
const csrfProtection = (req, res, next) => {
  const token = req.cookies.csrfToken || crypto.randomBytes(32).toString('hex');
  res.cookie('csrfToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict' });
  res.locals.csrfToken = token;
  next();
};

// Middleware to verify CSRF token
const verifyCsrfToken = (req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const tokenFromClient = req.body.csrfToken || req.headers['x-csrf-token'];
    const tokenFromCookie = req.cookies.csrfToken;

    if (tokenFromClient && tokenFromCookie && tokenFromClient === tokenFromCookie) {
      return next();
    }
    return res.status(403).send('Invalid CSRF token');
  }
  next();
};

module.exports = { csrfProtection, verifyCsrfToken };
