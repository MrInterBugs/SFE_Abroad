const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../data');
fs.mkdirSync(logDir, { recursive: true });

/* istanbul ignore next */
const logLevel = process.env.LOG_LEVEL || 'info';

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') })
  ],
});

module.exports = logger;
