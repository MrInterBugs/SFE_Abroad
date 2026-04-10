const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const helmet = require('helmet');
const logger = require('./utils/logger');
const { csrfProtection } = require('./utils/csrf');

const app = express();
const port = 3000;

// Create a rate limiter configuration
const rateLimiter = new RateLimiterMemory({
  points: 5,
  duration: 1,
});

// Middleware to apply rate limiting to a route
const rateLimiterMiddleware = (req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => {
      next();
    })
    .catch(() => {
      res.status(429).send('Too many requests, please try again later.');
    });
};

app.use(rateLimiterMiddleware);

// Middleware setup
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser()); 
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      "default-src": ["'self'"],
      "script-src": [
        "'self'",
        "'unsafe-inline'",
        "https://code.jquery.com",
        "https://cdn.jsdelivr.net",
      ],
      "script-src-attr": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "https://cdn.jsdelivr.net", "https://code.jquery.com"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
    },
  })
);

app.use(csrfProtection);

// Views setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
const indexRouter = require('./routes/index');
app.use('/', indexRouter);

const server = app.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}`);
  prefetchAllData();
});

// Eagerly fetch and cache all plan+year combinations on startup so that
// the SQLite DB is populated before gov.uk potentially removes older pages.
async function prefetchAllData() {
  const { getThresholdData } = require('./utils/fetchCountryData');
  const { SUPPORTED_YEARS } = require('./config/constants');
  const plans = ['plan1', 'plan2', 'plan4', 'plan5'];
  for (const year of SUPPORTED_YEARS) {
    for (const plan of plans) {
      try {
        await getThresholdData(plan, year);
        logger.info(`Prefetch complete: ${plan} ${year}`);
      } catch (err) {
        logger.warn(`Prefetch failed: ${plan} ${year} — ${err.message}`);
      }
    }
  }
}

module.exports = { app, server };
