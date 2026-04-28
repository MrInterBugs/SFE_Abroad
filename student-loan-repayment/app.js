const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const helmet = require('helmet');
const logger = require('./utils/logger');
const { csrfProtection } = require('./utils/csrf');
const { SUPPORTED_YEARS, ALLOWED_PLANS } = require('./config/constants');

const app = express();
const port = 3000;

// Trust the first proxy hop (Traefik) so req.ip is the real client IP,
// which makes rate limiting per-user rather than per-proxy.
app.set('trust proxy', 1);

// Rate limiter: 5 requests/second per IP
const rateLimiter = new RateLimiterMemory({ points: 5, duration: 1 });
app.use((req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).send('Too many requests, please try again later.'));
});

// Body parsing with size limits to prevent oversized payloads
app.use(bodyParser.urlencoded({ extended: false, limit: '10kb' }));
app.use(bodyParser.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
    },
  })
);

app.use(csrfProtection);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const indexRouter = require('./routes/index');
app.use('/', indexRouter);

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
