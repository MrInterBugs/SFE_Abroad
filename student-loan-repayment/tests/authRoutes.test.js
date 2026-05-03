'use strict';

jest.mock('argon2', () => ({
  argon2id: 2,
  hash: jest.fn(),
  verify: jest.fn(),
}));
jest.mock('../utils/db', () => ({
  createUser: jest.fn(),
  getUserByEmail: jest.fn(),
}));
jest.mock('../utils/auth', () => {
  const actual = jest.requireActual('../utils/auth');
  return {
    ...actual,
    authRateLimit: (req, res, next) => next(),
  };
});
jest.mock('../utils/logger', () => ({
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
    app = buildApp();
  });

  test('GET /register renders for anonymous users and redirects logged-in users', async () => {
    const anon = await request(app).get('/register');
    expect(anon.status).toBe(200);
    expect(anon.text).toContain('Create account');

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

  test('register creates a user, stores normalized session email, and redirects', async () => {
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
    expect(res.headers.location).toBe('/profile');
    expect(argon2.hash).toHaveBeenCalledWith('long-enough-password', expect.objectContaining({ type: argon2.argon2id }));
    expect(db.createUser).toHaveBeenCalledWith('NewUser@Example.com', 'hashed-password');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('New user registered'));
  });

  test('register reports duplicate and unexpected database errors', async () => {
    const { token, cookies } = await csrf(app, '/register');
    const body = {
      csrfToken: token,
      email: 'dupe@example.com',
      password: 'long-enough-password',
      confirmPassword: 'long-enough-password',
    };

    db.createUser.mockImplementationOnce(() => { throw new Error('UNIQUE constraint failed'); });
    const duplicate = await request(app).post('/register').set('Cookie', cookies).send(body);
    expect(duplicate.status).toBe(400);
    expect(duplicate.text).toContain('already exists');

    db.createUser.mockImplementationOnce(() => { throw new Error('disk full'); });
    const failure = await request(app).post('/register').set('Cookie', cookies).send(body);
    expect(failure.status).toBe(500);
    expect(failure.text).toContain('Something went wrong');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Register error'));
  });

  test('GET /login renders for anonymous users and redirects logged-in users', async () => {
    const anon = await request(app).get('/login');
    expect(anon.status).toBe(200);
    expect(anon.text).toContain('Sign in');

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
    db.getUserByEmail.mockReturnValue({ id: 8, email: 'known@example.com', password_hash: 'stored-hash' });
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
    db.getUserByEmail.mockReturnValue({ id: 8, email: 'known@example.com', password_hash: 'not-an-argon2-hash' });
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
    db.getUserByEmail.mockReturnValue({ id: 8, email: 'known@example.com', password_hash: 'stored-hash' });
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
    db.getUserByEmail.mockReturnValueOnce({ id: 8, email: 'known@example.com', password_hash: 'stored-hash' });
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
