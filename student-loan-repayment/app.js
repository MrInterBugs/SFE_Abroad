const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
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
if (!sessionSecret) {
  throw new Error('SESSION_SECRET environment variable must be set');
}
app.use(session({
  secret: sessionSecret,
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

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  res.locals.allowMarketingScripts = req.method === 'GET' && req.path === '/';
  next();
});

app.use(helmet({ contentSecurityPolicy: false }));

app.use((req, res, next) => {
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${res.locals.cspNonce}'`],
    'style-src': ["'self'", "'unsafe-inline'"],
    'font-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'frame-src': ["'none'"],
    'connect-src': ["'self'"],
    'upgrade-insecure-requests': [],
  };

  if (res.locals.allowMarketingScripts) {
    directives['script-src'].push(
      'https://pagead2.googlesyndication.com',
      'https://*.adtrafficquality.google',
      'https://consent.cookiebot.com',
      'https://consentcdn.cookiebot.com',
      'https://static.cloudflareinsights.com'
    );
    directives['img-src'].push('https:');
    directives['frame-src'] = [
      "'self'",
      'https://googleads.g.doubleclick.net',
      'https://tpc.googlesyndication.com',
      'https://pagead2.googlesyndication.com',
      'https://*.adtrafficquality.google',
      'https://consentcdn.cookiebot.com',
    ];
    directives['connect-src'].push(
      'https://pagead2.googlesyndication.com',
      'https://*.adtrafficquality.google',
      'https://consent.cookiebot.com',
      'https://consentcdn.cookiebot.com'
    );
  }

  const csp = Object.entries(directives)
    .map(([name, sources]) => sources.length ? `${name} ${sources.join(' ')}` : name)
    .join('; ');
  res.setHeader('Content-Security-Policy', csp);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist')));

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
