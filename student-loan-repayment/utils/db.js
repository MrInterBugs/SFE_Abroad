const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'thresholds.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS cached_thresholds (
    plan TEXT NOT NULL,
    year TEXT NOT NULL,
    country_name TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (plan, year, country_name)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    graduation_date TEXT,
    loan_value_gbp REAL,
    loan_value_pgl_gbp REAL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

const profileCols = db.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
if (!profileCols.includes('loan_value_pgl_gbp')) {
  db.exec('ALTER TABLE profiles ADD COLUMN loan_value_pgl_gbp REAL');
}

function saveThresholds(plan, year, countryDataDict) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO cached_thresholds (plan, year, country_name, data, fetched_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((entries) => {
    for (const [countryName, data] of Object.entries(entries)) {
      insert.run(plan, year, countryName, JSON.stringify(data), Date.now());
    }
  });
  insertMany(countryDataDict);
  logger.info(`DB: saved ${Object.keys(countryDataDict).length} countries for ${plan} ${year}`);
}

function loadThresholds(plan, year) {
  const rows = db.prepare(`
    SELECT country_name, data FROM cached_thresholds
    WHERE plan = ? AND year = ?
  `).all(plan, year);

  if (rows.length === 0) return null;

  const result = {};
  for (const row of rows) {
    result[row.country_name] = JSON.parse(row.data);
  }
  logger.info(`DB: loaded ${rows.length} countries for ${plan} ${year}`);
  return result;
}

function loadCountryList(plan, year) {
  const rows = db.prepare(`
    SELECT country_name FROM cached_thresholds
    WHERE plan = ? AND year = ?
    ORDER BY country_name
  `).all(plan, year);
  return rows.map(r => r.country_name);
}

function createUser(email, passwordHash) {
  const stmt = db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)');
  const result = stmt.run(email.toLowerCase(), passwordHash, Date.now());
  return result.lastInsertRowid;
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}

function getUserById(id) {
  return db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(id);
}

function getProfile(userId) {
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
}

function deleteUser(userId) {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function upsertProfile(userId, { graduationDate, loanValueGbp, loanValuePglGbp }) {
  db.prepare(`
    INSERT INTO profiles (user_id, graduation_date, loan_value_gbp, loan_value_pgl_gbp, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      graduation_date = excluded.graduation_date,
      loan_value_gbp = excluded.loan_value_gbp,
      loan_value_pgl_gbp = excluded.loan_value_pgl_gbp,
      updated_at = excluded.updated_at
  `).run(userId, graduationDate || null, loanValueGbp ?? null, loanValuePglGbp ?? null, Date.now());
}

module.exports = { saveThresholds, loadThresholds, loadCountryList, db, createUser, getUserByEmail, getUserById, getProfile, upsertProfile, deleteUser };
