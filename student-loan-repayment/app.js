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
const { SUPPORTED_YEARS, CACHE_PLANS, urlsByYear } = require('./config/constants');

const DEFAULT_PORT = 3000;

const rateLimiter = new RateLimiterMemory({ points: 15, duration: 1 });

function resolvePort(rawPort = process.env.PORT) {
  if (!rawPort) return DEFAULT_PORT;
  const port = Number(rawPort);
  return Number.isFinite(port) ? port : DEFAULT_PORT;
}

function isStaticRequest(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  return Boolean(path.extname(req.path)) || req.path.startsWith('/fonts/') || req.path.startsWith('/vendor/');
}

function isPrivatePage(req) {
  if (req.method !== 'GET') return true;
  return [
    '/login',
    '/register',
    '/check-email',
    '/forgot-password',
  ].includes(req.path)
    || req.path.startsWith('/profile')
    || req.path.startsWith('/reset-password/')
    || req.path.startsWith('/confirm-email/');
}

function requestPath(req) {
  const pathName = req.path || req.url || '/';
  if (pathName.startsWith('/reset-password/')) return '/reset-password/:token';
  if (pathName.startsWith('/confirm-email/')) return '/confirm-email/:token';
  return pathName;
}

function requestLogLine(req, res, durationMs) {
  return `HTTP ${req.method} ${requestPath(req)} ${res.statusCode} ${durationMs.toFixed(1)}ms`;
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = requestLogLine(req, res, durationMs);
    if (res.statusCode >= 400) {
      logger.warn(line);
      return;
    }
    logger.info(line);
  });
  next();
}

function createApp() {
  const app = express();

  // Trust the first proxy hop (Traefik) so req.ip is the real client IP,
  // which makes rate limiting per-user rather than per-proxy.
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    res.locals.allowMarketingScripts = !isPrivatePage(req);
    next();
  });

  app.use(helmet({ contentSecurityPolicy: false }));

  app.use((req, res, next) => {
    const directives = {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'object-src': ["'none'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
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
        'https://www.google.com',
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
  app.get('/calculator-domain.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'shared', 'calculator-domain.js'));
  });

  // Rate limiter: 15 dynamic requests/second per IP. Static assets are served
  // before this middleware and also explicitly bypassed if they fall through.
  app.use((req, res, next) => {
    if (isStaticRequest(req)) return next();
    return rateLimiter.consume(req.ip)
      .then(() => next())
      .catch(() => {
        logger.warn(`Rate limit exceeded: method=${req.method} path=${requestPath(req)}`);
        res.status(429).send('Too many requests, please try again later.');
      });
  });

  // Body parsing with size limits to prevent oversized payloads
  app.use(bodyParser.urlencoded({ extended: false, limit: '10kb' }));
  app.use(bodyParser.json({ limit: '10kb' }));
  app.use(cookieParser());

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable must be set');
  }
  const sessionStoreOptions = {};
  if (process.env.NODE_ENV === 'test') sessionStoreOptions.cleanupIntervalMs = 0;
  const sessionStore = new SqliteSessionStore(db, sessionStoreOptions);
  app.locals.sessionStore = sessionStore;

  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }));

  app.use(requestLogger);

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

  app.use((req, res) => {
    res.status(404).render('404');
  });

  return app;
}

// Eagerly fetch and cache all plan+year combinations on startup so the
// SQLite DB is populated before gov.uk potentially removes older pages.
async function prefetchAllData() {
  const { getThresholdData } = require('./utils/fetchCountryData');
  for (const year of SUPPORTED_YEARS) {
    for (const plan of CACHE_PLANS) {
      if (!urlsByYear[year]?.[plan]) {
        logger.info(`Prefetch skipped: ${plan} ${year} — no public source URL configured`);
        continue;
      }

      try {
        await getThresholdData(plan, year);
        logger.info(`Prefetch complete: ${plan} ${year}`);
      } catch (err) {
        logger.warn(`Prefetch failed: ${plan} ${year} — ${err.message}`);
      }
    }
  }
}

function startServer() {
  const app = createApp();
  const port = resolvePort();
  const server = app.listen(port, () => {
    const actualPort = server.address().port;
    logger.info(`Server running at http://localhost:${actualPort}`);
    prefetchAllData();
  });
  return { app, server };
}

/* istanbul ignore next */
if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer, prefetchAllData, isStaticRequest, isPrivatePage, requestLogLine, resolvePort };
