'use strict';

jest.mock('../utils/db', () => ({
  getUserById: jest.fn(),
  getProfile: jest.fn(),
  upsertProfile: jest.fn(),
  deleteUser: jest.fn(),
  loadCountryList: jest.fn(),
}));
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
const db = require('../utils/db');
const logger = require('../utils/logger');
const { csrfProtection } = require('../utils/csrf');

function buildApp() {
  const app = express();
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(cookieParser());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  app.use(csrfProtection);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.get('/seed-session', (req, res) => {
    req.session.userId = 42;
    req.session.userEmail = 'profile@example.com';
    res.send('ok');
  });
  app.use('/', require('../routes/profile'));
  return app;
}

async function loggedInAgent(app) {
  const agent = request.agent(app);
  await agent.get('/seed-session');
  return agent;
}

async function profileCsrf(agent) {
  const res = await agent.get('/profile');
  const match = res.text.match(/name="csrfToken" value="(.+?)"/);
  return match[1];
}

const VALID_PROFILE = {
  graduationDate: '2024-06',
  loanValueGbp: '12000',
  loanValuePglGbp: '3000',
  defaultCountry: 'Germany',
  defaultPlan: 'plan2',
  includePg: 'on',
  defaultSalary: '50000',
};

describe('profile routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    db.getUserById.mockReturnValue({ id: 42, email: 'profile@example.com', created_at: Date.now() });
    db.getProfile.mockReturnValue(null);
    db.loadCountryList.mockReturnValue(['France', 'Germany']);
    app = buildApp();
  });

  test('GET /profile redirects anonymous users and renders stored profile for logged-in users', async () => {
    const anon = await request(app).get('/profile');
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe('/login');

    db.getProfile.mockReturnValue({ default_country: 'Germany', default_plan: 'plan1', include_pg: 1 });
    const agent = await loggedInAgent(app);
    const res = await agent.get('/profile');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Germany');
    expect(db.loadCountryList).toHaveBeenCalledWith('plan1', expect.any(String));
  });

  test('POST /profile validates numeric fields, graduation date, and default plan', async () => {
    const agent = await loggedInAgent(app);
    const token = await profileCsrf(agent);

    const cases = [
      { loanValueGbp: '-1', text: 'undergraduate loan value' },
      { loanValuePglGbp: 'NaN', text: 'postgraduate loan value' },
      { defaultSalary: '-1', text: 'valid salary' },
      { graduationDate: 'June 2024', text: 'graduation date' },
      { defaultPlan: 'planPg', text: 'Invalid repayment plan' },
    ];

    for (const testCase of cases) {
      const res = await agent
        .post('/profile')
        .send({ ...VALID_PROFILE, ...testCase, csrfToken: token });
      expect(res.status).toBe(400);
      expect(res.text).toContain(testCase.text);
    }
    expect(db.upsertProfile).not.toHaveBeenCalled();
  });

  test('POST /profile stores parsed profile values and renders success', async () => {
    const agent = await loggedInAgent(app);
    const token = await profileCsrf(agent);
    db.getProfile.mockReturnValueOnce(null).mockReturnValueOnce({
      default_country: 'Germany',
      default_plan: 'plan2',
      include_pg: 1,
    });

    const res = await agent.post('/profile').send({ ...VALID_PROFILE, csrfToken: token });

    expect(res.status).toBe(200);
    expect(db.upsertProfile).toHaveBeenCalledWith(42, {
      graduationDate: '2024-06',
      loanValueGbp: 12000,
      loanValuePglGbp: 3000,
      defaultCountry: 'Germany',
      defaultPlan: 'plan2',
      includePg: true,
      defaultSalary: 50000,
    });
    expect(logger.info).toHaveBeenCalledWith('Profile updated for user id=42');
    expect(res.text).toContain('Profile saved');
  });

  test('POST /profile stores blank optional fields as null or false', async () => {
    const agent = await loggedInAgent(app);
    const token = await profileCsrf(agent);

    const res = await agent.post('/profile').send({
      csrfToken: token,
      graduationDate: '',
      loanValueGbp: '',
      loanValuePglGbp: '',
      defaultCountry: '',
      defaultPlan: '',
      defaultSalary: '',
    });

    expect(res.status).toBe(200);
    expect(db.upsertProfile).toHaveBeenCalledWith(42, {
      graduationDate: null,
      loanValueGbp: null,
      loanValuePglGbp: null,
      defaultCountry: null,
      defaultPlan: null,
      includePg: false,
      defaultSalary: null,
    });
  });

  test('POST /profile renders a server error when saving fails', async () => {
    const agent = await loggedInAgent(app);
    const token = await profileCsrf(agent);
    db.upsertProfile.mockImplementationOnce(() => { throw new Error('write failed'); });

    const res = await agent.post('/profile').send({ ...VALID_PROFILE, csrfToken: token });

    expect(res.status).toBe(500);
    expect(res.text).toContain('Something went wrong');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Profile update error'));
  });

  test('POST /profile/delete deletes the user after destroying the session', async () => {
    const agent = await loggedInAgent(app);
    const token = await profileCsrf(agent);

    const res = await agent.post('/profile/delete').send({ csrfToken: token });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(db.deleteUser).toHaveBeenCalledWith(42);
  });
});
