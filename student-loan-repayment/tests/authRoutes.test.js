'use strict';

jest.mock('argon2', () => ({
  argon2id: 2,
  hash: jest.fn(),
  verify: jest.fn(),
}));
jest.mock('../utils/db', () => ({
  createUser: jest.fn(),
  getUserByEmail: jest.fn(),
  confirmUserEmail: jest.fn(),
  updateUserPassword: jest.fn(),
  revokeUserSessions: jest.fn(),
  createAuthToken: jest.fn(),
  consumeAuthToken: jest.fn(),
  resetPasswordWithToken: jest.fn(),
  cleanupAuthTokens: jest.fn(),
  hasRecentAuthToken: jest.fn(),
  revokeOutstandingAuthTokens: jest.fn(),
}));
jest.mock('../utils/email', () => ({
  sendEmailConfirmation: jest.fn(),
  sendPasswordReset: jest.fn(),
}));
jest.mock('../utils/auth', () => {
  const actual = jest.requireActual('../utils/auth');
  return {
    ...actual,
    authRateLimit: (req, res, next) => next(),
  };
});
jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');
const argon2 = require('argon2');
const db = require('../utils/db');
const email = require('../utils/email');
const logger = require('../utils/logger');
const { csrfProtection } = require('../utils/csrf');

function buildApp() {
  const app = express();
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(cookieParser());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    if (req.headers['x-regenerate-error']) {
      req.session.regenerate = (cb) => cb(new Error('regen failed'));
    }
    next();
  });
  app.use(csrfProtection);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.get('/seed-session', (req, res) => {
    req.session.userId = 7;
    req.session.userEmail = 'seed@example.com';
    res.send('ok');
  });
  app.get('/seed-pending-confirmation', (req, res) => {
    req.session.pendingConfirmationEmail = 'known@example.com';
    res.send('ok');
  });
  app.use('/', require('../routes/auth'));
  return app;
}

async function csrf(app, pathName) {
  const res = await request(app).get(pathName);
  const match = res.text.match(/name="csrfToken" value="(.+?)"/);
  return { token: match[1], cookies: res.headers['set-cookie'] };
}

describe('auth routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    argon2.hash.mockResolvedValue('hashed-password');
    argon2.verify.mockResolvedValue(false);
    db.createUser.mockReturnValue(123);
    db.getUserByEmail.mockReturnValue(null);
    db.consumeAuthToken.mockReturnValue(null);
    db.resetPasswordWithToken.mockReturnValue(null);
    db.hasRecentAuthToken.mockReturnValue(false);
    email.sendEmailConfirmation.mockResolvedValue(true);
    email.sendPasswordReset.mockResolvedValue(true);
    app = buildApp();
  });

  test('GET /register renders for anonymous users and redirects logged-in users', async () => {
    const anon = await request(app).get('/register');
    expect(anon.status).toBe(200);
    expect(anon.text).toContain('Create account');
    expect(anon.text).toContain('<meta name="robots" content="noindex, nofollow">');

    const agent = request.agent(app);
    await agent.get('/seed-session');
    const loggedIn = await agent.get('/register');
    expect(loggedIn.status).toBe(302);
    expect(loggedIn.headers.location).toBe('/profile');
  });

  test('register rejects invalid input before hashing', async () => {
    const { token, cookies } = await csrf(app, '/register');

    const cases = [
      { body: { email: 5, password: 'long-enough', confirmPassword: 'long-enough' }, text: 'Invalid input' },
      { body: { email: 'bad', password: 'long-enough', confirmPassword: 'long-enough' }, text: 'valid email' },
      { body: { email: 'a@example.com', password: 'short', confirmPassword: 'short' }, text: 'at least 10' },
      { body: { email: 'a@example.com', password: 'long-enough', confirmPassword: 'different-one' }, text: 'do not match' },
    ];

    for (const testCase of cases) {
      const res = await request(app)
        .post('/register')
        .set('Cookie', cookies)
        .send({ csrfToken: token, ...testCase.body });
      expect(res.status).toBe(400);
      expect(res.text).toContain(testCase.text);
    }
    expect(argon2.hash).toHaveBeenCalledTimes(0);
  });

  test('register creates a user, sends confirmation email, and redirects', async () => {
    const agent = request.agent(app);
    const get = await agent.get('/register');
    const token = get.text.match(/name="csrfToken" value="(.+?)"/)[1];

    const res = await agent.post('/register').send({
      csrfToken: token,
      email: 'NewUser@Example.com',
      password: 'long-enough-password',
      confirmPassword: 'long-enough-password',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/check-email');
    expect(argon2.hash).toHaveBeenCalledWith('long-enough-password', expect.objectContaining({ type: argon2.argon2id }));
    expect(db.createUser).toHaveBeenCalledWith('NewUser@Example.com', 'hashed-password');
    expect(db.createAuthToken).toHaveBeenCalledWith(123, 'email-confirmation', expect.any(String), expect.any(Number));
    expect(email.sendEmailConfirmation).toHaveBeenCalledWith('newuser@example.com', expect.any(String));
    expect(logger.info).toHaveBeenCalledWith('Email sent: type=email-confirmation userId=123');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('New user registered'));
  });

  test('register revokes the confirmation token if email delivery fails', async () => {
    email.sendEmailConfirmation.mockRejectedValueOnce(new Error('resend offline'));
    const { token, cookies } = await csrf(app, '/register');

    const res = await request(app)
      .post('/register')
      .set('Cookie', cookies)
      .send({
        csrfToken: token,
        email: 'newuser@example.com',
        password: 'long-enough-password',
        confirmPassword: 'long-enough-password',
      });

    expect(res.status).toBe(500);
    expect(db.createAuthToken).toHaveBeenCalledWith(123, 'email-confirmation', expect.any(String), expect.any(Number));
    expect(db.revokeOutstandingAuthTokens).toHaveBeenCalledWith(123, 'email-confirmation');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Register error'));
  });

  test('check email page renders and resend confirmation handles missing, confirmed, and unconfirmed accounts', async () => {
    const anon = await request(app).get('/check-email');
    expect(anon.status).toBe(200);
    expect(anon.text).toContain('Check your email');
    expect(anon.text).toContain('id="email"');

    const agent = request.agent(app);
    await agent.get('/seed-pending-confirmation');
    const known = await agent.get('/check-email');
    expect(known.status).toBe(200);
    expect(known.text).toContain('still needs email confirmation');
    expect(known.text).toContain('known@example.com');
    expect(known.text).toContain('type="hidden" name="email" value="known@example.com"');
    expect(known.text).not.toContain('id="email"');
    expect(known.text).not.toContain('We sent a confirmation link');

    const first = await csrf(app, '/check-email');
    const invalid = await request(app)
      .post('/resend-confirmation')
      .set('Cookie', first.cookies)
      .send({ csrfToken: first.token, email: 'not-an-email' });
    expect(invalid.status).toBe(200);
    expect(invalid.text).toContain('If that email needs confirmation');

    db.getUserByEmail.mockReturnValueOnce(null);
    const second = await csrf(app, '/check-email');
    const missing = await request(app)
      .post('/resend-confirmation')
      .set('Cookie', second.cookies)
      .send({ csrfToken: second.token, email: 'missing@example.com' });
    expect(missing.status).toBe(200);
    expect(email.sendEmailConfirmation).not.toHaveBeenCalled();

    db.getUserByEmail.mockReturnValueOnce({ id: 8, email: 'known@example.com', email_confirmed_at: Date.now() });
    const third = await csrf(app, '/check-email');
    const confirmed = await request(app)
      .post('/resend-confirmation')
      .set('Cookie', third.cookies)
      .send({ csrfToken: third.token, email: 'known@example.com' });
    expect(confirmed.status).toBe(200);
    expect(email.sendEmailConfirmation).not.toHaveBeenCalled();

    db.getUserByEmail.mockReturnValueOnce({ id: 9, email: 'new@example.com', email_confirmed_at: null });
    const fourth = await csrf(app, '/check-email');
    const unconfirmed = await request(app)
      .post('/resend-confirmation')
      .set('Cookie', fourth.cookies)
      .send({ csrfToken: fourth.token, email: 'new@example.com' });
    expect(unconfirmed.status).toBe(200);
    expect(db.createAuthToken).toHaveBeenCalledWith(9, 'email-confirmation', expect.any(String), expect.any(Number));
    expect(email.sendEmailConfirmation).toHaveBeenCalledWith('new@example.com', expect.any(String));
    expect(logger.info).toHaveBeenCalledWith('Email sent: type=email-confirmation userId=9');
  });

  test('check email redirects logged-in users and reports resend failures', async () => {
    const agent = request.agent(app);
    await agent.get('/seed-session');
    const loggedIn = await agent.get('/check-email');
    expect(loggedIn.status).toBe(302);
    expect(loggedIn.headers.location).toBe('/profile');

    db.getUserByEmail.mockReturnValueOnce({ id: 9, email: 'new@example.com', email_confirmed_at: null });
    email.sendEmailConfirmation.mockRejectedValueOnce(new Error('resend offline'));
    const { token, cookies } = await csrf(app, '/check-email');
    const res = await request(app)
      .post('/resend-confirmation')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'new@example.com' });

    expect(res.status).toBe(500);
    expect(res.text).toContain('Something went wrong');
    expect(db.revokeOutstandingAuthTokens).toHaveBeenCalledWith(9, 'email-confirmation');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Confirmation resend error'));
  });

  test('register uses a neutral check-email response for duplicate accounts and reports unexpected database errors', async () => {
    const { token, cookies } = await csrf(app, '/register');
    const body = {
      csrfToken: token,
      email: 'dupe@example.com',
      password: 'long-enough-password',
      confirmPassword: 'long-enough-password',
    };

    db.createUser.mockImplementationOnce(() => { throw new Error('UNIQUE constraint failed'); });
    const duplicate = await request(app).post('/register').set('Cookie', cookies).send(body);
    expect(duplicate.status).toBe(302);
    expect(duplicate.headers.location).toBe('/check-email');

    db.createUser.mockImplementationOnce(() => { throw new Error('disk full'); });
    const failure = await request(app).post('/register').set('Cookie', cookies).send(body);
    expect(failure.status).toBe(500);
    expect(failure.text).toContain('Something went wrong');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Register error'));
  });

  test('resend confirmation observes the per-account email cooldown', async () => {
    db.getUserByEmail.mockReturnValueOnce({ id: 9, email: 'new@example.com', email_confirmed_at: null });
    db.hasRecentAuthToken.mockReturnValueOnce(true);
    const { token, cookies } = await csrf(app, '/check-email');

    const res = await request(app)
      .post('/resend-confirmation')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'new@example.com' });

    expect(res.status).toBe(200);
    expect(db.hasRecentAuthToken).toHaveBeenCalledWith(9, 'email-confirmation', expect.any(Number));
    expect(db.createAuthToken).not.toHaveBeenCalled();
    expect(email.sendEmailConfirmation).not.toHaveBeenCalled();
  });

  test('GET /login renders for anonymous users and redirects logged-in users', async () => {
    const anon = await request(app).get('/login');
    expect(anon.status).toBe(200);
    expect(anon.text).toContain('Sign in');
    expect(anon.text).not.toContain('Resend confirmation email');

    const confirmed = await request(app).get('/login?confirmed=1');
    expect(confirmed.text).toContain('Email confirmed');

    const reset = await request(app).get('/login?reset=1');
    expect(reset.text).toContain('Password updated');

    const agent = request.agent(app);
    await agent.get('/seed-session');
    const loggedIn = await agent.get('/login');
    expect(loggedIn.status).toBe(302);
    expect(loggedIn.headers.location).toBe('/profile');
  });

  test('login rejects missing or empty credentials', async () => {
    const { token, cookies } = await csrf(app, '/login');

    const invalidType = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: ['bad'], password: 'password' });
    expect(invalidType.status).toBe(400);

    const empty = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: '', password: '' });
    expect(empty.status).toBe(400);
    expect(empty.text).toContain('Email and password are required');
  });

  test('login verifies the dummy hash for unknown users and rejects the attempt', async () => {
    const { token, cookies } = await csrf(app, '/login');

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'missing@example.com', password: 'candidate-password' });

    expect(res.status).toBe(401);
    expect(argon2.verify).toHaveBeenCalledWith('hashed-password', 'candidate-password');
  });

  test('login rejects wrong passwords for known users', async () => {
    db.getUserByEmail.mockReturnValue({ id: 8, email: 'known@example.com', password_hash: 'stored-hash', email_confirmed_at: Date.now() });
    argon2.verify.mockResolvedValue(false);
    const { token, cookies } = await csrf(app, '/login');

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'known@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(argon2.verify).toHaveBeenCalledWith('stored-hash', 'wrong-password');
  });

  test('login treats password verification errors as invalid credentials', async () => {
    db.getUserByEmail.mockReturnValue({ id: 8, email: 'known@example.com', password_hash: 'not-an-argon2-hash', email_confirmed_at: Date.now() });
    argon2.verify.mockRejectedValue(new Error('invalid hash'));
    const { token, cookies } = await csrf(app, '/login');

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'known@example.com', password: 'candidate-password' });

    expect(res.status).toBe(401);
    expect(res.text).toContain('Incorrect email or password');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Password verification failed'));
  });

  test('login regenerates the session and redirects on valid credentials', async () => {
    db.getUserByEmail.mockReturnValue({ id: 8, email: 'known@example.com', password_hash: 'stored-hash', email_confirmed_at: Date.now() });
    argon2.verify.mockResolvedValue(true);
    const { token, cookies } = await csrf(app, '/login');

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'known@example.com', password: 'right-password' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(logger.info).toHaveBeenCalledWith('User logged in: id=8');
  });

  test('login handles session regeneration errors and lookup errors', async () => {
    db.getUserByEmail.mockReturnValueOnce({ id: 8, email: 'known@example.com', password_hash: 'stored-hash', email_confirmed_at: Date.now() });
    argon2.verify.mockResolvedValueOnce(true);
    const first = await csrf(app, '/login');
    const regen = await request(app)
      .post('/login')
      .set('Cookie', first.cookies)
      .set('x-regenerate-error', '1')
      .send({ csrfToken: first.token, email: 'known@example.com', password: 'right-password' });
    expect(regen.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Session regenerate error'));

    db.getUserByEmail.mockImplementationOnce(() => { throw new Error('db offline'); });
    const second = await csrf(app, '/login');
    const lookup = await request(app)
      .post('/login')
      .set('Cookie', second.cookies)
      .send({ csrfToken: second.token, email: 'known@example.com', password: 'right-password' });
    expect(lookup.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Login error'));
  });

  test('login rejects valid credentials until email is confirmed', async () => {
    db.getUserByEmail.mockReturnValue({ id: 8, email: 'known@example.com', password_hash: 'stored-hash', email_confirmed_at: null });
    argon2.verify.mockResolvedValue(true);
    const { token, cookies } = await csrf(app, '/login');

    const res = await request(app)
      .post('/login')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'known@example.com', password: 'right-password' });

    expect(res.status).toBe(403);
    expect(res.text).toContain('confirm your email');
    expect(res.text).toContain('Resend confirmation email');
  });

  test('confirm email consumes token and marks the user confirmed', async () => {
    db.consumeAuthToken.mockReturnValue({ userId: 8, email: 'known@example.com' });

    const agent = request.agent(app);
    await agent.get('/seed-pending-confirmation');
    const res = await agent.get('/confirm-email/good-token');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?confirmed=1');
    expect(db.consumeAuthToken).toHaveBeenCalledWith('good-token', 'email-confirmation');
    expect(db.confirmUserEmail).toHaveBeenCalledWith(8);
    expect(db.cleanupAuthTokens).toHaveBeenCalled();
  });

  test('confirm email works without a pending confirmation session value', async () => {
    db.consumeAuthToken.mockReturnValue({ userId: 8, email: 'known@example.com' });

    const res = await request(app).get('/confirm-email/good-token');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?confirmed=1');
    expect(db.confirmUserEmail).toHaveBeenCalledWith(8);
  });

  test('confirm email rejects invalid or expired tokens', async () => {
    const res = await request(app).get('/confirm-email/bad-token');

    expect(res.status).toBe(400);
    expect(res.text).toContain('confirmation link is invalid');
  });

  test('forgot password sends the same response for missing and known accounts', async () => {
    const invalid = await csrf(app, '/forgot-password');
    const invalidEmail = await request(app)
      .post('/forgot-password')
      .set('Cookie', invalid.cookies)
      .send({ csrfToken: invalid.token, email: 'not-an-email' });
    expect(invalidEmail.status).toBe(200);
    expect(invalidEmail.text).toContain('If that email has an account');

    const first = await csrf(app, '/forgot-password');
    const missing = await request(app)
      .post('/forgot-password')
      .set('Cookie', first.cookies)
      .send({ csrfToken: first.token, email: 'missing@example.com' });
    expect(missing.status).toBe(200);
    expect(missing.text).toContain('If that email has an account');
    expect(email.sendPasswordReset).not.toHaveBeenCalled();

    db.getUserByEmail.mockReturnValue({ id: 9, email: 'known@example.com' });
    const second = await csrf(app, '/forgot-password');
    const known = await request(app)
      .post('/forgot-password')
      .set('Cookie', second.cookies)
      .send({ csrfToken: second.token, email: 'known@example.com' });
    expect(known.status).toBe(200);
    expect(db.createAuthToken).toHaveBeenCalledWith(9, 'password-reset', expect.any(String), expect.any(Number));
    expect(email.sendPasswordReset).toHaveBeenCalledWith('known@example.com', expect.any(String));
    expect(logger.info).toHaveBeenCalledWith('Email sent: type=password-reset userId=9');
  });

  test('forgot password observes the per-account email cooldown', async () => {
    db.getUserByEmail.mockReturnValue({ id: 9, email: 'known@example.com' });
    db.hasRecentAuthToken.mockReturnValueOnce(true);
    const { token, cookies } = await csrf(app, '/forgot-password');

    const res = await request(app)
      .post('/forgot-password')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'known@example.com' });

    expect(res.status).toBe(200);
    expect(db.hasRecentAuthToken).toHaveBeenCalledWith(9, 'password-reset', expect.any(Number));
    expect(db.createAuthToken).not.toHaveBeenCalled();
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });

  test('forgot and reset forms redirect logged-in users to profile', async () => {
    const agent = request.agent(app);
    await agent.get('/seed-session');

    const forgot = await agent.get('/forgot-password');
    expect(forgot.status).toBe(302);
    expect(forgot.headers.location).toBe('/profile');

    const reset = await agent.get('/reset-password/reset-token');
    expect(reset.status).toBe(302);
    expect(reset.headers.location).toBe('/profile');
  });

  test('forgot password handles lookup or email errors', async () => {
    db.getUserByEmail.mockImplementationOnce(() => { throw new Error('db offline'); });
    const { token, cookies } = await csrf(app, '/forgot-password');

    const res = await request(app)
      .post('/forgot-password')
      .set('Cookie', cookies)
      .send({ csrfToken: token, email: 'known@example.com' });

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Password reset request error'));

    db.getUserByEmail.mockReturnValueOnce({ id: 9, email: 'known@example.com' });
    email.sendPasswordReset.mockRejectedValueOnce(new Error('resend offline'));
    const second = await csrf(app, '/forgot-password');

    const emailFailure = await request(app)
      .post('/forgot-password')
      .set('Cookie', second.cookies)
      .send({ csrfToken: second.token, email: 'known@example.com' });

    expect(emailFailure.status).toBe(500);
    expect(db.revokeOutstandingAuthTokens).toHaveBeenCalledWith(9, 'password-reset');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Password reset request error'));
  });

  test('reset password validates input and rejects invalid tokens', async () => {
    const get = await csrf(app, '/reset-password/reset-token');

    const invalidType = await request(app)
      .post('/reset-password/reset-token')
      .set('Cookie', get.cookies)
      .send({ csrfToken: get.token, password: ['bad'], confirmPassword: 'long-enough-password' });
    expect(invalidType.status).toBe(400);
    expect(invalidType.text).toContain('Invalid input');

    const short = await request(app)
      .post('/reset-password/reset-token')
      .set('Cookie', get.cookies)
      .send({ csrfToken: get.token, password: 'short', confirmPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.text).toContain('at least 10');

    const mismatch = await request(app)
      .post('/reset-password/reset-token')
      .set('Cookie', get.cookies)
      .send({ csrfToken: get.token, password: 'long-enough-password', confirmPassword: 'different-password' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.text).toContain('do not match');

    const invalid = await request(app)
      .post('/reset-password/reset-token')
      .set('Cookie', get.cookies)
      .send({ csrfToken: get.token, password: 'long-enough-password', confirmPassword: 'long-enough-password' });
    expect(invalid.status).toBe(400);
    expect(invalid.text).toContain('reset link is invalid');
    expect(argon2.hash).toHaveBeenCalledWith('long-enough-password', expect.objectContaining({ type: argon2.argon2id }));
  });

  test('reset password updates hash and redirects', async () => {
    db.resetPasswordWithToken.mockReturnValue({ userId: 9, email: 'known@example.com' });
    const { token, cookies } = await csrf(app, '/reset-password/reset-token');

    const res = await request(app)
      .post('/reset-password/reset-token')
      .set('Cookie', cookies)
      .send({ csrfToken: token, password: 'new-long-password', confirmPassword: 'new-long-password' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?reset=1');
    expect(argon2.hash).toHaveBeenCalledWith('new-long-password', expect.objectContaining({ type: argon2.argon2id }));
    expect(db.resetPasswordWithToken).toHaveBeenCalledWith('reset-token', 'hashed-password');
    expect(db.updateUserPassword).not.toHaveBeenCalled();
    expect(db.revokeUserSessions).not.toHaveBeenCalled();
  });

  test('reset password handles hashing or update errors', async () => {
    db.resetPasswordWithToken.mockReturnValue({ userId: 9, email: 'known@example.com' });
    argon2.hash.mockRejectedValueOnce(new Error('hash failed'));
    const { token, cookies } = await csrf(app, '/reset-password/reset-token');

    const res = await request(app)
      .post('/reset-password/reset-token')
      .set('Cookie', cookies)
      .send({ csrfToken: token, password: 'new-long-password', confirmPassword: 'new-long-password' });

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Password reset error'));
  });

  test('logout destroys the session and redirects home', async () => {
    const agent = request.agent(app);
    const get = await agent.get('/login');
    const token = get.text.match(/name="csrfToken" value="(.+?)"/)[1];
    await agent.get('/seed-session');

    const res = await agent.post('/logout').send({ csrfToken: token });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});
