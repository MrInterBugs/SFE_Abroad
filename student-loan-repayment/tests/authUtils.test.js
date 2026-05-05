'use strict';

const { requireAuth, authRateLimit, clearAuthRateLimiter, SqliteSessionStore } = require('../utils/auth');

function callMiddleware(middleware, req) {
  return new Promise((resolve) => {
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn((body) => resolve({ status: res.status.mock.calls.at(-1)?.[0], body })),
      redirect: jest.fn((location) => resolve({ redirect: location })),
    };
    middleware(req, res, () => resolve({ next: true }));
  });
}

function createFakeDb() {
  const rows = new Map();
  const prepare = jest.fn((sql) => ({
    get: jest.fn((sid) => rows.get(sid)),
    run: jest.fn((...args) => {
      if (sql.startsWith('INSERT OR REPLACE')) {
        const [sid, data, expires] = args;
        rows.set(sid, { data, expires });
      } else if (sql.startsWith('DELETE FROM sessions WHERE sid')) {
        rows.delete(args[0]);
      } else if (sql.startsWith('UPDATE sessions')) {
        const [expires, sid] = args;
        const existing = rows.get(sid);
        if (existing) rows.set(sid, { ...existing, expires });
      }
      return { changes: 1 };
    }),
  }));
  return { rows, prepare };
}

function promisifyStoreCall(method, ...args) {
  return new Promise((resolve) => {
    method(...args, (err, value) => resolve({ err, value }));
  });
}

describe('auth utilities', () => {
  test('SqliteSessionStore periodically clears expired sessions', () => {
    jest.useFakeTimers();
    const fakeDb = createFakeDb();
    const store = new SqliteSessionStore(fakeDb);

    jest.advanceTimersByTime(15 * 60 * 1000);

    expect(fakeDb.prepare).toHaveBeenCalledWith('DELETE FROM sessions WHERE expires < ?');
    store.close();
    store.close();
    jest.useRealTimers();
  });

  test('SqliteSessionStore can disable periodic cleanup', () => {
    jest.useFakeTimers();
    const fakeDb = createFakeDb();
    const store = new SqliteSessionStore(fakeDb, { cleanupIntervalMs: 0 });

    jest.advanceTimersByTime(15 * 60 * 1000);

    expect(fakeDb.prepare).not.toHaveBeenCalledWith('DELETE FROM sessions WHERE expires < ?');
    store.close();
    jest.useRealTimers();
  });

  test('requireAuth redirects anonymous sessions and allows authenticated sessions', async () => {
    await expect(callMiddleware(requireAuth, { session: {} })).resolves.toEqual({ redirect: '/login' });
    await expect(callMiddleware(requireAuth, { session: { userId: 1 } })).resolves.toEqual({ next: true });
  });

  test('authRateLimit allows initial attempts and rejects excessive attempts per IP', async () => {
    const req = { ip: `auth-test-${Date.now()}` };
    for (let i = 0; i < 10; i += 1) {
      await expect(callMiddleware(authRateLimit, req)).resolves.toEqual({ next: true });
    }
    await expect(callMiddleware(authRateLimit, req)).resolves.toEqual({
      status: 429,
      body: 'Too many attempts, please try again later.',
    });
    clearAuthRateLimiter();
  });

  test('SqliteSessionStore reads, writes, touches, expires, and destroys sessions', async () => {
    const fakeDb = createFakeDb();
    const store = new SqliteSessionStore(fakeDb);
    const expires = new Date(Date.now() + 60_000);

    await expect(promisifyStoreCall(store.set.bind(store), 'sid-1', { cookie: { expires }, userId: 1 }))
      .resolves.toEqual({ err: null, value: undefined });
    await expect(promisifyStoreCall(store.get.bind(store), 'sid-1'))
      .resolves.toEqual({ err: null, value: { cookie: { expires: expires.toISOString() }, userId: 1 } });

    await expect(promisifyStoreCall(store.touch.bind(store), 'sid-1', { cookie: {} }))
      .resolves.toEqual({ err: null, value: undefined });
    expect(fakeDb.rows.get('sid-1').expires).toBeGreaterThan(Date.now());

    fakeDb.rows.set('expired', { data: JSON.stringify({ userId: 2 }), expires: Date.now() - 1 });
    await expect(promisifyStoreCall(store.get.bind(store), 'expired'))
      .resolves.toEqual({ err: null, value: null });
    await expect(promisifyStoreCall(store.get.bind(store), 'missing'))
      .resolves.toEqual({ err: null, value: null });

    await expect(promisifyStoreCall(store.destroy.bind(store), 'sid-1'))
      .resolves.toEqual({ err: null, value: undefined });
    expect(fakeDb.rows.has('sid-1')).toBe(false);
    store.close();
  });

  test('SqliteSessionStore uses fallback expiry for set and explicit expiry for touch', async () => {
    const fakeDb = createFakeDb();
    const store = new SqliteSessionStore(fakeDb);
    const expires = new Date(Date.now() + 90_000);

    await promisifyStoreCall(store.set.bind(store), 'sid-2', { cookie: {}, value: 'fallback' });
    expect(fakeDb.rows.get('sid-2').expires).toBeGreaterThan(Date.now());

    await promisifyStoreCall(store.touch.bind(store), 'sid-2', { cookie: { expires } });
    expect(fakeDb.rows.get('sid-2').expires).toBe(expires.getTime());
    store.close();
  });

  test('SqliteSessionStore passes database and JSON errors to callbacks', async () => {
    const throwingDb = { prepare: jest.fn(() => { throw new Error('prepare failed'); }) };
    const store = new SqliteSessionStore(throwingDb);

    for (const [method, args] of [
      ['get', ['sid']],
      ['set', ['sid', { cookie: {} }]],
      ['destroy', ['sid']],
      ['touch', ['sid', { cookie: {} }]],
    ]) {
      const result = await promisifyStoreCall(store[method].bind(store), ...args);
      expect(result.err).toBeInstanceOf(Error);
      expect(result.err.message).toBe('prepare failed');
    }

    const fakeDb = createFakeDb();
    const jsonStore = new SqliteSessionStore(fakeDb);
    fakeDb.rows.set('bad-json', { data: '{', expires: Date.now() + 1000 });
    const result = await promisifyStoreCall(jsonStore.get.bind(jsonStore), 'bad-json');
    expect(result.err).toBeInstanceOf(SyntaxError);
    store.close();
    jsonStore.close();
  });
});
