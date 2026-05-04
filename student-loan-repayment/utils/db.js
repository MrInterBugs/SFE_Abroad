const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'thresholds.db'));
db.pragma('foreign_keys = ON');

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
    email_confirmed_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    graduation_date TEXT,
    loan_value_gbp REAL,
    loan_value_pgl_gbp REAL,
    default_country TEXT,
    default_plan TEXT,
    include_pg INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    country TEXT NOT NULL,
    plan TEXT NOT NULL,
    tax_year TEXT NOT NULL,
    salary_local REAL,
    salary_gbp REAL,
    exchange_rate REAL,
    threshold_gbp REAL,
    monthly_repayment REAL,
    include_pg INTEGER NOT NULL DEFAULT 0,
    pgl_monthly_repayment REAL,
    pgl_threshold_gbp REAL,
    calculated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_calculations_user_id ON calculations(user_id);

  CREATE TABLE IF NOT EXISTS anonymous_calculation_stats (
    stat_date TEXT NOT NULL,
    country TEXT NOT NULL,
    plan TEXT NOT NULL,
    tax_year TEXT NOT NULL,
    include_pg INTEGER NOT NULL DEFAULT 0,
    calculation_count INTEGER NOT NULL DEFAULT 0,
    first_calculated_at INTEGER NOT NULL,
    last_calculated_at INTEGER NOT NULL,
    PRIMARY KEY (stat_date, country, plan, tax_year, include_pg)
  );
`);

function ensureProfileColumns(database) {
  const profileCols = database.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
  if (!profileCols.includes('loan_value_pgl_gbp')) database.exec('ALTER TABLE profiles ADD COLUMN loan_value_pgl_gbp REAL');
  if (!profileCols.includes('default_country'))     database.exec('ALTER TABLE profiles ADD COLUMN default_country TEXT');
  if (!profileCols.includes('default_plan'))        database.exec('ALTER TABLE profiles ADD COLUMN default_plan TEXT');
  if (!profileCols.includes('include_pg'))          database.exec('ALTER TABLE profiles ADD COLUMN include_pg INTEGER NOT NULL DEFAULT 0');
  if (!profileCols.includes('default_salary'))      database.exec('ALTER TABLE profiles ADD COLUMN default_salary REAL');
}

ensureProfileColumns(db);

function ensureUserColumns(database) {
  const userCols = database.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('email_confirmed_at')) {
    database.exec('ALTER TABLE users ADD COLUMN email_confirmed_at INTEGER');
    database.exec('UPDATE users SET email_confirmed_at = created_at WHERE email_confirmed_at IS NULL');
  }
}

ensureUserColumns(db);

function ensureCalculationColumns(database) {
  const calculationCols = database.prepare('PRAGMA table_info(calculations)').all().map(c => c.name);
  if (!calculationCols.includes('include_pg')) database.exec('ALTER TABLE calculations ADD COLUMN include_pg INTEGER NOT NULL DEFAULT 0');
  if (!calculationCols.includes('pgl_monthly_repayment')) database.exec('ALTER TABLE calculations ADD COLUMN pgl_monthly_repayment REAL');
  if (!calculationCols.includes('pgl_threshold_gbp')) database.exec('ALTER TABLE calculations ADD COLUMN pgl_threshold_gbp REAL');

  const updatedCalculationCols = database.prepare('PRAGMA table_info(calculations)').all();
  const sensitiveRequiredCols = new Set(['salary_local', 'salary_gbp', 'exchange_rate', 'threshold_gbp', 'monthly_repayment']);
  const hasRequiredSensitiveColumns = updatedCalculationCols.some(c => sensitiveRequiredCols.has(c.name) && c.notnull);
  if (hasRequiredSensitiveColumns) {
    database.exec(`
      CREATE TABLE calculations_privacy_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        country TEXT NOT NULL,
        plan TEXT NOT NULL,
        tax_year TEXT NOT NULL,
        salary_local REAL,
        salary_gbp REAL,
        exchange_rate REAL,
        threshold_gbp REAL,
        monthly_repayment REAL,
        include_pg INTEGER NOT NULL DEFAULT 0,
        pgl_monthly_repayment REAL,
        pgl_threshold_gbp REAL,
        calculated_at INTEGER NOT NULL
      );

      INSERT INTO calculations_privacy_migration
        (id, user_id, country, plan, tax_year, include_pg, calculated_at)
      SELECT id, user_id, country, plan, tax_year, include_pg, calculated_at
      FROM calculations;

      DROP TABLE calculations;
      ALTER TABLE calculations_privacy_migration RENAME TO calculations;
      CREATE INDEX IF NOT EXISTS idx_calculations_user_id ON calculations(user_id);
    `);
  }

  const statCols = database.prepare('PRAGMA table_info(anonymous_calculation_stats)').all().map(c => c.name);
  if (!statCols.includes('include_pg')) database.exec('ALTER TABLE anonymous_calculation_stats ADD COLUMN include_pg INTEGER NOT NULL DEFAULT 0');
}

ensureCalculationColumns(db);

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
  return db.prepare('SELECT id, email, email_confirmed_at, created_at FROM users WHERE id = ?').get(id);
}

function confirmUserEmail(userId) {
  db.prepare('UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?) WHERE id = ?').run(Date.now(), userId);
}

function updateUserPassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

function revokeUserSessions(userId) {
  const rows = db.prepare('SELECT sid, data FROM sessions').all();
  const deleteSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
  let revoked = 0;

  const revokeMany = db.transaction((sessions) => {
    for (const row of sessions) {
      try {
        const session = JSON.parse(row.data);
        if (session.userId === userId) {
          deleteSession.run(row.sid);
          revoked += 1;
        }
      } catch (err) {
        logger.warn(`DB: could not parse session ${row.sid} during revocation: ${err.message}`);
      }
    }
  });

  revokeMany(rows);
  return revoked;
}

function hashAuthToken(token) {
  return require('crypto').createHash('sha256').update(token).digest('hex');
}

function revokeOutstandingAuthTokens(userId, purpose) {
  return db.prepare(`
    UPDATE auth_tokens
    SET used_at = ?
    WHERE user_id = ?
      AND purpose = ?
      AND used_at IS NULL
      AND expires_at > ?
  `).run(Date.now(), userId, purpose, Date.now()).changes;
}

function hasRecentAuthToken(userId, purpose, since) {
  const row = db.prepare(`
    SELECT 1
    FROM auth_tokens
    WHERE user_id = ?
      AND purpose = ?
      AND used_at IS NULL
      AND expires_at > ?
      AND created_at >= ?
    LIMIT 1
  `).get(userId, purpose, Date.now(), since);
  return Boolean(row);
}

function createAuthToken(userId, purpose, token, expiresAt) {
  cleanupAuthTokens();
  revokeOutstandingAuthTokens(userId, purpose);
  const stmt = db.prepare(`
    INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(userId, purpose, hashAuthToken(token), expiresAt, Date.now());
}

function consumeAuthToken(token, purpose) {
  const tokenHash = hashAuthToken(token);
  const row = db.prepare(`
    SELECT auth_tokens.id, auth_tokens.user_id, users.email
    FROM auth_tokens
    JOIN users ON users.id = auth_tokens.user_id
    WHERE auth_tokens.token_hash = ?
      AND auth_tokens.purpose = ?
      AND auth_tokens.used_at IS NULL
      AND auth_tokens.expires_at > ?
  `).get(tokenHash, purpose, Date.now());

  if (!row) return null;

  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return { userId: row.user_id, email: row.email };
}

function cleanupAuthTokens(now = Date.now()) {
  return db.prepare('DELETE FROM auth_tokens WHERE used_at IS NOT NULL OR expires_at <= ?').run(now).changes;
}

function statDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function logAnonymousCalculationStats({ country, plan, taxYear, includePg }, now = Date.now()) {
  db.prepare(`
    INSERT INTO anonymous_calculation_stats
      (stat_date, country, plan, tax_year, include_pg, calculation_count, first_calculated_at, last_calculated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(stat_date, country, plan, tax_year, include_pg) DO UPDATE SET
      calculation_count = calculation_count + 1,
      last_calculated_at = excluded.last_calculated_at
  `).run(statDate(now), country, plan, taxYear, includePg ? 1 : 0, now, now);
}

function getAnonymousCalculationStats() {
  return db.prepare(`
    SELECT * FROM anonymous_calculation_stats
    ORDER BY stat_date DESC, country ASC, plan ASC, tax_year ASC, include_pg ASC
  `).all();
}

function logCalculation(userId, { country, plan, taxYear, includePg }) {
  if (!userId) {
    logAnonymousCalculationStats({ country, plan, taxYear, includePg });
    return;
  }

  db.prepare(`
    INSERT INTO calculations
      (user_id, country, plan, tax_year, include_pg, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    country, plan, taxYear,
    includePg ? 1 : 0,
    Date.now(),
  );
}

function getCalculationsForUser(userId) {
  return db.prepare(`
    SELECT * FROM calculations WHERE user_id = ? ORDER BY calculated_at DESC
  `).all(userId);
}

function getProfile(userId) {
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
}

function deleteUser(userId) {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function upsertProfile(userId, { graduationDate, loanValueGbp, loanValuePglGbp, defaultCountry, defaultPlan, includePg, defaultSalary }) {
  db.prepare(`
    INSERT INTO profiles (user_id, graduation_date, loan_value_gbp, loan_value_pgl_gbp, default_country, default_plan, include_pg, default_salary, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      graduation_date = excluded.graduation_date,
      loan_value_gbp = excluded.loan_value_gbp,
      loan_value_pgl_gbp = excluded.loan_value_pgl_gbp,
      default_country = excluded.default_country,
      default_plan = excluded.default_plan,
      include_pg = excluded.include_pg,
      default_salary = excluded.default_salary,
      updated_at = excluded.updated_at
  `).run(userId, graduationDate || null, loanValueGbp ?? null, loanValuePglGbp ?? null, defaultCountry || null, defaultPlan || null, includePg ? 1 : 0, defaultSalary ?? null, Date.now());
}

module.exports = {
  saveThresholds,
  loadThresholds,
  loadCountryList,
  db,
  ensureProfileColumns,
  ensureUserColumns,
  ensureCalculationColumns,
  createUser,
  getUserByEmail,
  getUserById,
  confirmUserEmail,
  updateUserPassword,
  revokeUserSessions,
  createAuthToken,
  consumeAuthToken,
  cleanupAuthTokens,
  revokeOutstandingAuthTokens,
  hasRecentAuthToken,
  logCalculation,
  logAnonymousCalculationStats,
  getAnonymousCalculationStats,
  getCalculationsForUser,
  getProfile,
  upsertProfile,
  deleteUser,
};
