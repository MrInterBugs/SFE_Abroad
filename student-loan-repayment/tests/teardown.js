'use strict';

afterAll(() => {
  try {
    const { clearAuthRateLimiter } = require('../utils/auth');
    clearAuthRateLimiter();
  } catch (_err) {
    // Some isolated tests do not load the auth module.
  }

  try {
    const { db } = require('../utils/db');
    if (db.open) db.close();
  } catch (_err) {
    // Some isolated tests do not load the database module.
  }
});
