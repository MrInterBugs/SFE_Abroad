'use strict';

const {
  saveThresholds,
  loadThresholds,
  loadCountryList,
  ensureProfileColumns,
  ensureUserColumns,
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
  db,
} = require('../utils/db');

// Each test run gets a unique plan/year key so repeated runs (and parallel
// Jest workers) never collide with each other or with prefetched real data.
const RUN_ID = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const PLAN = `plan_${RUN_ID}`;
const YEAR = `year_${RUN_ID}`;

const SAMPLE_DATA = {
  Germany: {
    'Exchange rate': '1.15',
    Currency: 'Euro',
    'Earnings threshold (GBP)': '£22,000',
  },
  France: {
    'Exchange rate': '1.15',
    Currency: 'Euro',
    'Earnings threshold (GBP)': '£22,000',
  },
};

describe('db', () => {
  test('loadThresholds returns null for an unknown plan/year', () => {
    expect(loadThresholds(`unknown_${RUN_ID}`, 'no-such-year')).toBeNull();
  });

  test('loadCountryList returns an empty array for an unknown plan/year', () => {
    expect(loadCountryList(`unknown2_${RUN_ID}`, 'no-such-year')).toEqual([]);
  });

  test('saveThresholds persists data that loadThresholds can retrieve', () => {
    saveThresholds(PLAN, YEAR, SAMPLE_DATA);
    const result = loadThresholds(PLAN, YEAR);
    expect(result).toEqual(SAMPLE_DATA);
  });

  test('loadCountryList returns alphabetically sorted country names after a save', () => {
    // Data was written by the previous test; tests in a single file are sequential.
    const result = loadCountryList(PLAN, YEAR);
    expect(result).toEqual(['France', 'Germany']);
  });

  test('saveThresholds with INSERT OR REPLACE updates an existing row', () => {
    const updated = {
      Germany: {
        'Exchange rate': '1.99',
        Currency: 'Euro',
        'Earnings threshold (GBP)': '£25,000',
      },
    };
    saveThresholds(PLAN, YEAR, updated);

    const result = loadThresholds(PLAN, YEAR);
    expect(result['Germany']['Exchange rate']).toBe('1.99');
    // France row from the earlier save should still be present
    expect(result['France']).toBeDefined();
  });

  test('saveThresholds with an empty dict completes without error', () => {
    const emptyPlan = `empty_${RUN_ID}`;
    expect(() => saveThresholds(emptyPlan, YEAR, {})).not.toThrow();
    // Nothing stored → null
    expect(loadThresholds(emptyPlan, YEAR)).toBeNull();
  });

  test('user helpers normalize email, omit password hash by id, and delete users', () => {
    const email = `User_${RUN_ID}@Example.com`;
    const userId = createUser(email, 'hash-value');

    const byEmail = getUserByEmail(email.toUpperCase());
    expect(byEmail).toMatchObject({
      id: userId,
      email: email.toLowerCase(),
      password_hash: 'hash-value',
    });

    const byId = getUserById(userId);
    expect(byId).toMatchObject({ id: userId, email: email.toLowerCase() });
    expect(byId.password_hash).toBeUndefined();

    deleteUser(userId);
    expect(getUserById(userId)).toBeUndefined();
    expect(getUserByEmail(email)).toBeUndefined();
  });

  test('email confirmation, password update, and auth tokens work together', () => {
    const email = `token_${RUN_ID}@example.com`;
    const userId = createUser(email, 'old-hash');

    confirmUserEmail(userId);
    expect(getUserByEmail(email).email_confirmed_at).toEqual(expect.any(Number));

    updateUserPassword(userId, 'new-hash');
    expect(getUserByEmail(email).password_hash).toBe('new-hash');

    createAuthToken(userId, 'password-reset', 'plain-token', Date.now() + 10000);
    expect(hasRecentAuthToken(userId, 'password-reset', Date.now() - 1000)).toBe(true);
    expect(consumeAuthToken('wrong-token', 'password-reset')).toBeNull();
    expect(consumeAuthToken('plain-token', 'email-confirmation')).toBeNull();
    expect(consumeAuthToken('plain-token', 'password-reset')).toMatchObject({ userId, email: email.toLowerCase() });
    expect(consumeAuthToken('plain-token', 'password-reset')).toBeNull();

    createAuthToken(userId, 'password-reset', 'expired-token', Date.now() - 10000);
    expect(consumeAuthToken('expired-token', 'password-reset')).toBeNull();
    expect(cleanupAuthTokens()).toBeGreaterThanOrEqual(1);

    deleteUser(userId);
  });

  test('creating a new auth token invalidates older outstanding tokens of the same purpose', () => {
    const email = `rotate_${RUN_ID}@example.com`;
    const userId = createUser(email, 'hash');

    createAuthToken(userId, 'password-reset', 'first-token', Date.now() + 10000);
    createAuthToken(userId, 'password-reset', 'second-token', Date.now() + 10000);

    expect(consumeAuthToken('first-token', 'password-reset')).toBeNull();
    expect(consumeAuthToken('second-token', 'password-reset')).toMatchObject({ userId });

    deleteUser(userId);
  });

  test('auth token revocation helper marks outstanding tokens as used', () => {
    const email = `revoke_token_${RUN_ID}@example.com`;
    const userId = createUser(email, 'hash');

    createAuthToken(userId, 'email-confirmation', 'confirm-token', Date.now() + 10000);
    expect(revokeOutstandingAuthTokens(userId, 'email-confirmation')).toBe(1);
    expect(consumeAuthToken('confirm-token', 'email-confirmation')).toBeNull();

    deleteUser(userId);
  });

  test('revokeUserSessions deletes only sessions for the requested user', () => {
    const keepSid = `keep_${RUN_ID}`;
    const revokeSid = `revoke_${RUN_ID}`;
    const malformedSid = `malformed_${RUN_ID}`;
    const expires = Date.now() + 10000;

    db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)')
      .run(keepSid, JSON.stringify({ userId: 1001, cookie: {} }), expires);
    db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)')
      .run(revokeSid, JSON.stringify({ userId: 1002, cookie: {} }), expires);
    db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)')
      .run(malformedSid, '{bad-json', expires);

    expect(revokeUserSessions(1002)).toBe(1);
    expect(db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(revokeSid)).toBeUndefined();
    expect(db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(keepSid)).toBeDefined();
    expect(db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(malformedSid)).toBeDefined();

    db.prepare('DELETE FROM sessions WHERE sid IN (?, ?)').run(keepSid, malformedSid);
  });

  test('profile helpers insert, update, coerce nullable fields, and cascade on delete', () => {
    const email = `profile_${RUN_ID}@example.com`;
    const userId = createUser(email, 'hash-value');

    expect(getProfile(userId)).toBeUndefined();

    upsertProfile(userId, {
      graduationDate: '2024-06',
      loanValueGbp: 12000,
      loanValuePglGbp: 3000,
      defaultCountry: 'Germany',
      defaultPlan: 'plan1',
      includePg: true,
      defaultSalary: 50000,
    });
    expect(getProfile(userId)).toMatchObject({
      user_id: userId,
      graduation_date: '2024-06',
      loan_value_gbp: 12000,
      loan_value_pgl_gbp: 3000,
      default_country: 'Germany',
      default_plan: 'plan1',
      include_pg: 1,
      default_salary: 50000,
    });

    upsertProfile(userId, {
      graduationDate: '',
      loanValueGbp: undefined,
      loanValuePglGbp: undefined,
      defaultCountry: '',
      defaultPlan: '',
      includePg: false,
      defaultSalary: undefined,
    });
    expect(getProfile(userId)).toMatchObject({
      graduation_date: null,
      loan_value_gbp: null,
      loan_value_pgl_gbp: null,
      default_country: null,
      default_plan: null,
      include_pg: 0,
      default_salary: null,
    });

    createAuthToken(userId, 'password-reset', `cascade-token-${RUN_ID}`, Date.now() + 10000);
    logCalculation(userId, {
      country: 'Germany',
      plan: 'plan1',
      taxYear: '2025-26',
      salaryLocal: 50000,
      salaryGbp: 43478,
      exchangeRate: 1.15,
      thresholdGbp: 22000,
      monthlyRepayment: 160.59,
      includePg: false,
      pglMonthlyRepayment: null,
      pglThresholdGbp: null,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM auth_tokens WHERE user_id = ?').get(userId).count).toBe(1);
    expect(getCalculationsForUser(userId)).toHaveLength(1);

    deleteUser(userId);
    expect(getProfile(userId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM auth_tokens WHERE user_id = ?').get(userId).count).toBe(0);
    expect(getCalculationsForUser(userId)).toHaveLength(0);
  });

  test('ensureProfileColumns adds missing migration columns and skips existing ones', () => {
    const exec = jest.fn();
    const fakeDb = {
      prepare: jest.fn(() => ({
        all: jest.fn(() => [
          { name: 'user_id' },
          { name: 'loan_value_pgl_gbp' },
          { name: 'default_country' },
        ]),
      })),
      exec,
    };

    ensureProfileColumns(fakeDb);

    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec).toHaveBeenCalledWith('ALTER TABLE profiles ADD COLUMN default_plan TEXT');
    expect(exec).toHaveBeenCalledWith('ALTER TABLE profiles ADD COLUMN include_pg INTEGER NOT NULL DEFAULT 0');
    expect(exec).toHaveBeenCalledWith('ALTER TABLE profiles ADD COLUMN default_salary REAL');

    const emptySchemaExec = jest.fn();
    ensureProfileColumns({
      prepare: jest.fn(() => ({ all: jest.fn(() => [{ name: 'user_id' }]) })),
      exec: emptySchemaExec,
    });
    expect(emptySchemaExec).toHaveBeenCalledWith('ALTER TABLE profiles ADD COLUMN loan_value_pgl_gbp REAL');
    expect(emptySchemaExec).toHaveBeenCalledWith('ALTER TABLE profiles ADD COLUMN default_country TEXT');
  });

  test('logCalculation stores signed-in rows and aggregates anonymous usage', () => {
    const email = `calc_${RUN_ID}@example.com`;
    const userId = createUser(email, 'hash');

    const fields = {
      country: 'Germany',
      plan: 'plan1',
      taxYear: '2025-26',
      salaryLocal: 50000,
      salaryGbp: 43478,
      exchangeRate: 1.15,
      thresholdGbp: 22000,
      monthlyRepayment: 160.59,
      includePg: false,
      pglMonthlyRepayment: null,
      pglThresholdGbp: null,
    };

    logCalculation(userId, fields);
    const anonymousCountry = `Australia ${RUN_ID}`;
    logCalculation(null, { ...fields, country: anonymousCountry });

    const rows = getCalculationsForUser(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: userId,
      country: 'Germany',
      plan: 'plan1',
      tax_year: '2025-26',
      salary_local: 50000,
      monthly_repayment: 160.59,
      include_pg: 0,
      pgl_monthly_repayment: null,
    });

    const anonRows = getAnonymousCalculationStats().filter(r => r.country === anonymousCountry && r.tax_year === '2025-26');
    expect(anonRows).toHaveLength(1);
    expect(anonRows[0]).toMatchObject({
      country: anonymousCountry,
      plan: 'plan1',
      tax_year: '2025-26',
      include_pg: 0,
      calculation_count: 1,
    });
    expect(anonRows[0].salary_local).toBeUndefined();
    expect(anonRows[0].monthly_repayment).toBeUndefined();

    deleteUser(userId);
    expect(getCalculationsForUser(userId)).toHaveLength(0);
  });

  test('logAnonymousCalculationStats increments daily aggregate rows', () => {
    const now = Date.UTC(2026, 4, 4, 12, 0, 0);
    const fields = {
      country: `Aggregate Land ${RUN_ID}`,
      plan: 'plan2',
      taxYear: '2025-26',
      includePg: true,
    };

    logAnonymousCalculationStats(fields, now);
    logAnonymousCalculationStats(fields, now + 60000);

    const rows = getAnonymousCalculationStats().filter(r => r.country === fields.country);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stat_date: '2026-05-04',
      country: fields.country,
      plan: 'plan2',
      tax_year: '2025-26',
      include_pg: 1,
      calculation_count: 2,
      first_calculated_at: now,
      last_calculated_at: now + 60000,
    });
  });

  test('logCalculation stores PGL fields and orders results newest-first', () => {
    const email = `calc_pg_${RUN_ID}@example.com`;
    const userId = createUser(email, 'hash');

    logCalculation(userId, {
      country: 'Germany', plan: 'plan1', taxYear: '2025-26',
      salaryLocal: 40000, salaryGbp: 34782, exchangeRate: 1.15,
      thresholdGbp: 22000, monthlyRepayment: 97.06,
      includePg: true, pglMonthlyRepayment: 72.5, pglThresholdGbp: 21000,
    });
    logCalculation(userId, {
      country: 'France', plan: 'plan2', taxYear: '2025-26',
      salaryLocal: 60000, salaryGbp: 52174, exchangeRate: 1.15,
      thresholdGbp: 22000, monthlyRepayment: 272.35,
      includePg: false, pglMonthlyRepayment: null, pglThresholdGbp: null,
    });

    const rows = getCalculationsForUser(userId);
    expect(rows).toHaveLength(2);
    expect(rows[0].country).toBe('France');
    expect(rows[1].country).toBe('Germany');
    expect(rows[0].include_pg).toBe(0);
    expect(rows[1].include_pg).toBe(1);
    expect(rows[1].pgl_monthly_repayment).toBe(72.5);

    deleteUser(userId);
  });

  test('ensureUserColumns adds confirmation column and backfills existing users', () => {
    const exec = jest.fn();
    const fakeDb = {
      prepare: jest.fn(() => ({
        all: () => [{ name: 'id' }, { name: 'email' }, { name: 'password_hash' }, { name: 'created_at' }],
      })),
      exec,
    };

    ensureUserColumns(fakeDb);
    expect(exec).toHaveBeenCalledWith('ALTER TABLE users ADD COLUMN email_confirmed_at INTEGER');
    expect(exec).toHaveBeenCalledWith('UPDATE users SET email_confirmed_at = created_at WHERE email_confirmed_at IS NULL');

    exec.mockClear();
    fakeDb.prepare = jest.fn(() => ({
      all: () => [{ name: 'email_confirmed_at' }],
    }));
    ensureUserColumns(fakeDb);
    expect(exec).not.toHaveBeenCalled();
  });
});
