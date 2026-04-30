'use strict';

// Load .env if present (e.g. mounted via Docker BuildKit secret during CI).
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim();
  }
}

process.env.SESSION_SECRET ??= 'test-secret-for-jest';
