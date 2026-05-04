'use strict';

const { csrfProtection, verifyCsrfToken } = require('../utils/csrf');

// Factory for a minimal mock response object
function makeRes() {
  const res = { locals: {} };
  res.cookie = jest.fn();
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

// ─── csrfProtection ──────────────────────────────────────────────────────────

describe('csrfProtection', () => {
  test('uses the token stored in the server-side session', () => {
    const req = { cookies: { csrfToken: 'cookie-token' }, session: { csrfToken: 'session-token' }, path: '/' };
    const res = makeRes();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(res.locals.csrfToken).toBe('session-token');
    expect(res.cookie).toHaveBeenCalledWith(
      'csrfToken',
      'session-token',
      expect.any(Object)
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('does not issue a token before necessary cookie consent on pages that do not need forms', () => {
    const req = { cookies: {}, session: {}, path: '/' };
    const res = makeRes();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(res.locals.csrfToken).toBe('');
    expect(res.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('generates a fresh 64-character hex token once necessary cookies are accepted', () => {
    const req = { cookies: { CookieConsent: 'necessary%3Atrue' }, session: {}, path: '/' };
    const res = makeRes();
    const next = jest.fn();

    csrfProtection(req, res, next);

    const token = res.locals.csrfToken;
    expect(typeof token).toBe('string');
    expect(token).toHaveLength(64); // 32 random bytes → 64 hex chars
    expect(req.session.csrfToken).toBe(token);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('generates a token for account forms even before consent', () => {
    const req = { cookies: {}, session: {}, path: '/login' };
    const res = makeRes();

    csrfProtection(req, res, jest.fn());

    expect(res.locals.csrfToken).toHaveLength(64);
    expect(res.cookie).toHaveBeenCalledWith(
      'csrfToken',
      res.locals.csrfToken,
      expect.any(Object)
    );
  });

  test('sets httpOnly and Strict sameSite cookie options', () => {
    const req = { cookies: { CookieConsent: 'necessary%3Atrue' }, session: {}, path: '/' };
    const res = makeRes();

    csrfProtection(req, res, jest.fn());

    const [, , opts] = res.cookie.mock.calls[0];
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('Strict');
  });

  test('secure flag is false outside production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const req = { cookies: { CookieConsent: 'necessary%3Atrue' }, session: {}, path: '/' };
    const res = makeRes();

    csrfProtection(req, res, jest.fn());

    const [, , opts] = res.cookie.mock.calls[0];
    expect(opts.secure).toBe(false);
    process.env.NODE_ENV = original;
  });

  test('secure flag is true in production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const req = { cookies: { CookieConsent: 'necessary%3Atrue' }, session: {}, path: '/' };
    const res = makeRes();

    csrfProtection(req, res, jest.fn());

    const [, , opts] = res.cookie.mock.calls[0];
    expect(opts.secure).toBe(true);
    process.env.NODE_ENV = original;
  });
});

// ─── verifyCsrfToken ─────────────────────────────────────────────────────────

describe('verifyCsrfToken', () => {
  test('passes GET requests through without checking the token', () => {
    const req = { method: 'GET', body: {}, headers: {}, cookies: {} };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes non-mutating methods (e.g. OPTIONS) through', () => {
    const req = { method: 'OPTIONS', body: {}, headers: {}, cookies: {} };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('accepts POST when body token matches cookie token', () => {
    const token = 'matching-token-abc';
    const req = {
      method: 'POST',
      body: { csrfToken: token },
      headers: {},
      cookies: { csrfToken: token },
      session: { csrfToken: token },
    };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('accepts POST when x-csrf-token header matches cookie token', () => {
    const token = 'header-token-xyz';
    const req = {
      method: 'POST',
      body: {},
      headers: { 'x-csrf-token': token },
      cookies: { csrfToken: token },
      session: { csrfToken: token },
    };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects POST when body token does not match cookie token', () => {
    const req = {
      method: 'POST',
      body: { csrfToken: 'wrong' },
      headers: {},
      cookies: { csrfToken: 'correct' },
      session: { csrfToken: 'correct' },
    };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Invalid CSRF token');
  });

  test('rejects POST when no client token is provided at all', () => {
    const req = {
      method: 'POST',
      body: {},
      headers: {},
      cookies: { csrfToken: 'correct' },
      session: { csrfToken: 'correct' },
    };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('rejects PUT with a mismatched token', () => {
    const req = {
      method: 'PUT',
      body: { csrfToken: 'wrong' },
      headers: {},
      cookies: { csrfToken: 'correct' },
      session: { csrfToken: 'correct' },
    };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('accepts DELETE when token matches', () => {
    const token = 'delete-token';
    const req = {
      method: 'DELETE',
      body: { csrfToken: token },
      headers: {},
      cookies: { csrfToken: token },
      session: { csrfToken: token },
    };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects POST when cookie and body match but the session token differs', () => {
    const req = {
      method: 'POST',
      body: { csrfToken: 'injected-token' },
      headers: {},
      cookies: { csrfToken: 'injected-token' },
      session: { csrfToken: 'server-token' },
    };
    const res = makeRes();
    const next = jest.fn();

    verifyCsrfToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
