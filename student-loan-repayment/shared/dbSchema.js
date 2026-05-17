const BASE_SCHEMA_SQL = `
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
    expires INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
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
`;

function columnNames(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function ensureProfileColumns(database) {
  const profileCols = columnNames(database, 'profiles');
  if (!profileCols.includes('loan_value_pgl_gbp')) database.exec('ALTER TABLE profiles ADD COLUMN loan_value_pgl_gbp REAL');
  if (!profileCols.includes('default_country'))     database.exec('ALTER TABLE profiles ADD COLUMN default_country TEXT');
  if (!profileCols.includes('default_plan'))        database.exec('ALTER TABLE profiles ADD COLUMN default_plan TEXT');
  if (!profileCols.includes('include_pg'))          database.exec('ALTER TABLE profiles ADD COLUMN include_pg INTEGER NOT NULL DEFAULT 0');
  if (!profileCols.includes('default_salary'))      database.exec('ALTER TABLE profiles ADD COLUMN default_salary REAL');
}

function ensureUserColumns(database) {
  const userCols = columnNames(database, 'users');
  if (!userCols.includes('email_confirmed_at')) {
    database.exec('ALTER TABLE users ADD COLUMN email_confirmed_at INTEGER');
    database.exec('UPDATE users SET email_confirmed_at = created_at WHERE email_confirmed_at IS NULL');
  }
}

function ensureCalculationColumns(database) {
  const calculationCols = columnNames(database, 'calculations');
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

  const statCols = columnNames(database, 'anonymous_calculation_stats');
  if (!statCols.includes('include_pg')) database.exec('ALTER TABLE anonymous_calculation_stats ADD COLUMN include_pg INTEGER NOT NULL DEFAULT 0');
}

function ensureSessionColumns(database) {
  const cols = columnNames(database, 'sessions');
  if (!cols.includes('user_id')) {
    database.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
    const rows = database.prepare('SELECT sid, data FROM sessions').all();
    const update = database.prepare('UPDATE sessions SET user_id = ? WHERE sid = ?');
    const backfill = database.transaction(() => {
      for (const row of rows) {
        try {
          const session = JSON.parse(row.data);
          if (session.userId) update.run(session.userId, row.sid);
        } catch { /* skip malformed */ }
      }
    });
    backfill();
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
}

function initializeDatabase(database) {
  database.exec(BASE_SCHEMA_SQL);
  ensureProfileColumns(database);
  ensureUserColumns(database);
  ensureCalculationColumns(database);
  ensureSessionColumns(database);
}

module.exports = {
  BASE_SCHEMA_SQL,
  initializeDatabase,
  ensureProfileColumns,
  ensureUserColumns,
  ensureCalculationColumns,
  ensureSessionColumns,
};
