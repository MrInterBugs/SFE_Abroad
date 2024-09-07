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
app.use(helmet());
app.use(express.static(path.join(__dirname, 'public')));

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
