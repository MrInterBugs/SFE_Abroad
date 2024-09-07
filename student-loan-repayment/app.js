const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const logger = require('./utils/logger');

const app = express();
const port = 3000;

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


// Views setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
const indexRouter = require('./routes/index');
app.use('/', indexRouter);

const server = app.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}`);
});

module.exports = { app, server };
