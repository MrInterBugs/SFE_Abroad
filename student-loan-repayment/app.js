const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const helmet = require('helmet');
const logger = require('./utils/logger');
const { csrfProtection } = require('./utils/csrf');
const { SqliteSessionStore } = require('./utils/auth');
const { db } = require('./utils/db');
const { SUPPORTED_YEARS, ALLOWED_PLANS } = require('./config/constants');

const app = express();
const port = 3000;

// Trust the first proxy hop (Traefik) so req.ip is the real client IP,
// which makes rate limiting per-user rather than per-proxy.
app.set('trust proxy', 1);

// Rate limiter: 15 requests/second per IP
const rateLimiter = new RateLimiterMemory({ points: 15, duration: 1 });
app.use((req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).send('Too many requests, please try again later.'));
});

// Body parsing with size limits to prevent oversized payloads
app.use(bodyParser.urlencoded({ extended: false, limit: '10kb' }));
app.use(bodyParser.json({ limit: '10kb' }));
app.use(cookieParser());

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET environment variable must be set in production');
}
app.use(session({
  secret: sessionSecret || 'dev-only-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  store: new SqliteSessionStore(db),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://pagead2.googlesyndication.com', 'https://*.adtrafficquality.google', 'https://consent.cookiebot.com', 'https://static.cloudflareinsights.com'],
      'style-src': ["'self'"],
      'font-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'frame-src': ["'self'", 'https://googleads.g.doubleclick.net', 'https://tpc.googlesyndication.com', 'https://pagead2.googlesyndication.com', 'https://*.adtrafficquality.google'],
      'connect-src': ["'self'", 'https://pagead2.googlesyndication.com', 'https://*.adtrafficquality.google'],
    },
  })
);

app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.userId = req.session.userId || null;
  res.locals.userEmail = req.session.userEmail || null;
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const indexRouter = require('./routes/index');
const authRouter = require('./routes/auth');
const profileRouter = require('./routes/profile');
app.use('/', indexRouter);
app.use('/', authRouter);
app.use('/', profileRouter);

const server = app.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}`);
  prefetchAllData();
});

// Eagerly fetch and cache all plan+year combinations on startup so the
// SQLite DB is populated before gov.uk potentially removes older pages.
async function prefetchAllData() {
  const { getThresholdData } = require('./utils/fetchCountryData');
  for (const year of SUPPORTED_YEARS) {
    for (const plan of ALLOWED_PLANS) {
      try {
        await getThresholdData(plan, year);
        logger.info(`Prefetch complete: ${plan} ${year}`);
      } catch (err) {
        logger.warn(`Prefetch failed: ${plan} ${year} — ${err.message}`);
      }
    }
  }
}

module.exports = { app, server, prefetchAllData };
