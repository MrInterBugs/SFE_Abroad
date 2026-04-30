const { Store } = require('express-session');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Stricter rate limiter for auth endpoints: 10 attempts per 15 minutes per IP
const authRateLimiter = new RateLimiterMemory({ points: 10, duration: 900 });

const authRateLimit = (req, res, next) => {
  authRateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).send('Too many attempts, please try again later.'));
};

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  next();
};

class SqliteSessionStore extends Store {
  constructor(db) {
    super();
    this._db = db;
    setInterval(() => {
      this._db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    }, 15 * 60 * 1000).unref();
  }

  get(sid, cb) {
    try {
      const row = this._db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }

  set(sid, session, cb) {
    try {
      const expires = session.cookie?.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + 24 * 60 * 60 * 1000;
      this._db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(session), expires);
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    try {
      this._db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }

  touch(sid, session, cb) {
    try {
      const expires = session.cookie?.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + 24 * 60 * 60 * 1000;
      this._db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(expires, sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}

module.exports = { requireAuth, authRateLimit, SqliteSessionStore };
