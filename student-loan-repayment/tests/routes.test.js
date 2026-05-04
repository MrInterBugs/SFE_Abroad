'use strict';

// Mock data utilities before any require() so the router gets the mocks.
jest.mock('../utils/fetchCountryData');
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');

const { csrfProtection } = require('../utils/csrf');
const { fetchCountryData, getThresholdData } = require('../utils/fetchCountryData');
const { createUser, upsertProfile } = require('../utils/db');
const db = require('../utils/db');
const logger = require('../utils/logger');
const { DEFAULT_YEAR, SUPPORTED_YEARS } = require('../config/constants');
const { SEO_PAGES } = require('../config/seoPages');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const THRESHOLD_DATA = {
  Australia: {
    'Exchange rate': '0.52',
    Currency: 'Australian Dollar',
    'Earnings threshold (GBP)': '£19,084',
    'Lower earnings threshold (GBP)': '£15,000',
  },
  Germany: {
    'Exchange rate': '1.15',
    Currency: 'Euro',
    'Earnings threshold (GBP)': '£22,000',
    'Lower earnings threshold (GBP)': '£18,000',
  },
};

const PG_THRESHOLD_DATA = {
  Germany: {
    'Exchange rate': '1.15',
    Currency: 'Euro',
    'Earnings threshold (GBP)': '£21,000',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal express app that mirrors the real app's middleware stack. */
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
    req.session.userId = Number(req.query.userId);
    req.session.userEmail = req.query.email;
    res.send('ok');
  });
  // Fresh require each call — module is cached by Node after first load, which
  // is fine here because we control mock implementations per-test via mockXxx.
  app.use('/', require('../routes/index'));
  return app;
}

/**
 * GET / on the given app and extract the CSRF token from the HTML and
 * the set-cookie header so a subsequent POST can be authenticated.
 */
async function getCsrfToken(app) {
  const res = await request(app)
    .get('/')
    .set('Cookie', 'CookieConsent=necessary%3Atrue');
  const match = res.text.match(/name="csrfToken" value="(.+?)"/);
  if (!match) throw new Error('Could not find CSRF token in rendered HTML');
  return { token: match[1], cookies: res.headers['set-cookie'] };
}

/**
 * Perform a full CSRF-authenticated POST /calculate against the given app.
 * Additional cookies (e.g. preference cookies) can be passed via `extraCookies`.
 */
async function postCalculate(app, body, extraCookies = []) {
  const { token, cookies } = await getCsrfToken(app);
  return request(app)
    .post('/calculate')
    .set('Cookie', [...cookies, ...extraCookies])
    .send({ csrfToken: token, ...body });
}

/**
 * Like postCalculate but sends Accept: application/json so the route returns
 * JSON instead of rendering result.ejs.
 */
async function postCalculateJson(app, body, extraCookies = []) {
  const { token, cookies } = await getCsrfToken(app);
  return request(app)
    .post('/calculate')
    .set('Cookie', [...cookies, ...extraCookies])
    .set('Accept', 'application/json')
    .send({ csrfToken: token, ...body });
}

async function createProfileAgent(app, profile = {}) {
  const email = `routes_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const userId = createUser(email, 'hash');
  upsertProfile(userId, {
    graduationDate: profile.graduationDate ?? '2024-06',
    loanValueGbp: profile.loanValueGbp ?? 12000,
    loanValuePglGbp: profile.loanValuePglGbp ?? 3000,
    defaultCountry: profile.defaultCountry ?? 'Germany',
    defaultPlan: profile.defaultPlan ?? 'plan4',
    includePg: profile.includePg ?? true,
    defaultSalary: profile.defaultSalary ?? 50000,
  });
  const agent = request.agent(app);
  await agent.get(`/seed-session?userId=${userId}&email=${encodeURIComponent(email)}`);
  return { agent, userId };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('routes', () => {
  let app;

  beforeEach(() => {
    fetchCountryData.mockResolvedValue(['Germany', 'France']);
    getThresholdData.mockResolvedValue(THRESHOLD_DATA);
    app = buildApp();
  });

  afterEach(() => jest.clearAllMocks());

  // ─── GET / ──────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    test('GET /privacy renders the privacy page', async () => {
      const res = await request(app).get('/privacy');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Privacy');
      expect(res.text).toContain('Last updated: 4 May 2026');
      expect(res.text).toContain('machine-readable JSON file');
      expect(res.text).toContain('Calculator defaults');
      expect(res.text).toContain('Anonymous calculation statistics');
      expect(res.text).toContain('Cookiebot&rsquo;s floating consent control');
    });

    test('GET /about renders an indexable trust page', async () => {
      const res = await request(app).get('/about');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<link rel="canonical" href="https://sfe.aedanl.com/about">');
      expect(res.text).toContain('not affiliated with Student Finance England');
      expect(res.text).not.toContain('noindex');
    });

    test('GET /methodology renders the formula and source notes', async () => {
      const res = await request(app).get('/methodology');
      expect(res.status).toBe(200);
      expect(res.text).toContain('monthly repayment = max(0, salary in GBP - overseas threshold)');
      expect(res.text).toContain('GOV.UK overseas earnings threshold publications');
      expect(res.text).not.toContain('noindex');
    });

    test('GET plan SEO landing page renders with canonical metadata', async () => {
      const res = await request(app).get('/plan-2-overseas-repayment');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Plan 2 Overseas Student Loan Repayment');
      expect(res.text).toContain('<link rel="canonical" href="https://sfe.aedanl.com/plan-2-overseas-repayment">');
      expect(res.text).toContain('BreadcrumbList');
    });

    test('all configured SEO pages are routed', async () => {
      const responses = await Promise.all(
        SEO_PAGES.map((page) => request(app).get(`/${page.slug}`))
      );
      responses.forEach((res) => expect(res.status).toBe(200));
    });

    test('GET country SEO landing page renders threshold examples', async () => {
      const res = await request(app).get('/student-loan-overseas-repayment-germany');
      expect(res.status).toBe(200);
      expect(res.text).toContain('UK Student Loan Repayment While Living in Germany');
      expect(res.text).toContain('<td>Plan 1</td>');
      expect(res.text).toContain('<td>£22,000</td>');
    });

    test('GET country SEO landing page still renders when threshold data is missing', async () => {
      const res = await request(app).get('/student-loan-overseas-repayment-canada');
      expect(res.status).toBe(200);
      expect(res.text).toContain('UK Student Loan Repayment While Living in Canada');
      expect(res.text).not.toContain('<table class="seo-table">');
    });

    test('GET country SEO landing page tolerates threshold fetch failures', async () => {
      getThresholdData.mockImplementation((plan) => {
        if (plan === 'plan1') return Promise.reject(new Error('offline'));
        return Promise.resolve(THRESHOLD_DATA);
      });
      const res = await request(app).get('/student-loan-overseas-repayment-germany');
      expect(res.status).toBe(200);
      expect(res.text).toContain('UK Student Loan Repayment While Living in Germany');
      expect(res.text).toContain('<td>Plan 2</td>');
    });

    test('GET country SEO landing page shows n/a when an exchange rate is absent', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          Currency: 'Euro',
          'Earnings threshold (GBP)': '£22,000',
          'Lower earnings threshold (GBP)': '£18,000',
        },
      });
      const res = await request(app).get('/student-loan-overseas-repayment-germany');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<td>n/a</td>');
    });

    test('renders the index page with a 200', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('csrfToken');
      expect(res.text).toContain('id="calc-error"');
      expect(res.text).toContain('UK Student Loan Overseas Repayment Calculator');
      expect(res.text).not.toContain('/vendor/chart.js/chart.umd.min.js"></script>');
    });

    test('does not emit a CSRF token cookie before necessary cookie consent', async () => {
      const res = await request(app).get('/');
      const setCookie = (res.headers['set-cookie'] || []).join(';');
      expect(setCookie).not.toContain('csrfToken=');
      expect(res.text).toContain('name="csrfToken" value=""');
    });

    test('emits a CSRF token cookie after necessary cookie consent', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', 'CookieConsent=necessary%3Atrue');
      const setCookie = (res.headers['set-cookie'] || []).join(';');
      expect(setCookie).toContain('csrfToken=');
      expect(res.text).toMatch(/name="csrfToken" value="[a-f0-9]{64}"/);
    });

    test('GET /csrf-token refuses requests before necessary cookie consent', async () => {
      const res = await request(app).get('/csrf-token');
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Necessary cookies');
    });

    test('GET /csrf-token returns a token after necessary cookie consent', async () => {
      const res = await request(app)
        .get('/csrf-token')
        .set('Cookie', 'CookieConsent=necessary%3Atrue');
      const setCookie = (res.headers['set-cookie'] || []).join(';');
      expect(res.status).toBe(200);
      expect(res.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
      expect(setCookie).toContain('csrfToken=');
    });

    test('defaults to plan1 when no selectedPlan cookie is set', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    test('reads a valid selectedPlan cookie (plan2)', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['selectedPlan=plan2']);
      expect(res.status).toBe(200);
    });

    test('ignores an invalid selectedPlan cookie and defaults to plan1', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['selectedPlan=planX']);
      expect(res.status).toBe(200);
    });

    test('reads a valid selectedYear cookie', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', [`selectedYear=${SUPPORTED_YEARS[0]}`]);
      expect(res.status).toBe(200);
    });

    test('ignores an invalid selectedYear cookie and falls back to current year', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['selectedYear=not-a-year']);
      expect(res.status).toBe(200);
    });

    test('reads includePg=true cookie', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['includePg=true']);
      expect(res.status).toBe(200);
    });

    test('reads selectedCountry cookie', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['selectedCountry=Germany']);
      expect(res.status).toBe(200);
    });

    test('keeps preference cookies when preference consent is present', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['CookieConsent=preferences%3Atrue', 'selectedPlan=plan2', 'includePg=true']);
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie'].join(';')).not.toContain('selectedPlan=;');
    });

    test('uses saved profile defaults ahead of preference cookies', async () => {
      const { agent } = await createProfileAgent(app, {
        defaultCountry: 'Germany',
        defaultPlan: 'plan4',
        includePg: true,
        defaultSalary: 61000,
      });

      const res = await agent
        .get('/')
        .set('Cookie', 'CookieConsent=preferences%3Atrue; selectedPlan=plan2; selectedCountry=Australia; includePg=false');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/id="plan4" value="plan4" checked/);
      expect(res.text).toContain('name="targetCountry" placeholder="e.g. Germany, Australia, Canada…" autocomplete="off" value="Germany"');
      expect(res.text).toContain('id="pgl-check" name="includePg" checked');
      expect(res.text).toContain('name="salaryLocalCurrency" placeholder="0" min="0" step="1000" value="61000"');
    });

    test('falls back to preference cookies when saved profile defaults are not valid', async () => {
      const { agent } = await createProfileAgent(app, {
        defaultCountry: '',
        defaultPlan: 'not-a-plan',
        includePg: false,
      });

      const res = await agent
        .get('/')
        .set('Cookie', 'CookieConsent=preferences%3Atrue; selectedPlan=plan2; selectedCountry=Australia; includePg=true');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/id="plan2" value="plan2" checked/);
      expect(res.text).toContain('name="targetCountry" placeholder="e.g. Germany, Australia, Canada…" autocomplete="off" value="Australia"');
      expect(res.text).toContain('id="pgl-check" name="includePg" >');
    });

    test('still renders 200 (with empty country list) when getThresholdData throws', async () => {
      getThresholdData.mockRejectedValue(new Error('gov.uk unreachable'));
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('csrfToken');
    });

    test('keeps a valid selected plan in the error fallback render', async () => {
      getThresholdData.mockRejectedValue(new Error('gov.uk unreachable'));
      const res = await request(app)
        .get('/')
        .set('Cookie', ['CookieConsent=preferences%3Atrue', 'selectedPlan=plan2']);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/id="plan2" value="plan2" checked/);
    });

    test('includes sorted countries with currency data in the page', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      // Both countries from THRESHOLD_DATA should appear in the app-data JSON
      expect(res.text).toContain('Australia');
      expect(res.text).toContain('Germany');
    });

    test('handles countries with missing or unmapped currency without throwing', async () => {
      getThresholdData.mockResolvedValue({
        Narnia: {
          // No Currency field — exercises the `data['Currency'] || ''` fallback
          'Exchange rate': '1.00',
          'Earnings threshold (GBP)': '£22,000',
        },
        Fantasia: {
          // Currency not in NAME_TO_ISO map — exercises the `NAME_TO_ISO[x] || ''` fallback
          Currency: 'Frobozian Groat',
          'Exchange rate': '1.00',
          'Earnings threshold (GBP)': '£22,000',
        },
        Germany: {
          Currency: 'Euro',
          'Exchange rate': '1.15',
          'Earnings threshold (GBP)': '£22,000',
        },
      });
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Germany');
    });
  });

  // ─── POST /calculate ────────────────────────────────────────────────────────

  describe('POST /calculate', () => {
    test('returns 200 and sets preference cookies on a valid request', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      }, ['CookieConsent=preferences%3Atrue']);

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toEqual(
        expect.arrayContaining([
          expect.stringContaining('selectedPlan=plan1'),
          expect.stringContaining('selectedCountry=Germany'),
          expect.stringContaining(`selectedYear=${DEFAULT_YEAR}`),
        ])
      );
    });

    test('uses the lower earnings threshold field for plan2', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan2',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(200);
    });

    test('plan4 uses the standard earnings threshold field', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan4',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(200);
    });

    test('returns 400 when selectedPlan is not in ALLOWED_PLANS', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'planX',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
      expect(res.text).toContain('Invalid repayment plan selected');
    });

    test('returns 400 for a non-numeric salary', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: 'not-a-number',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
      expect(res.text).toContain('valid positive salary');
    });

    test('returns 400 for a zero salary', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '0',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 for a negative salary', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '-500',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 for Infinity as salary', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: 'Infinity',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
    });

    test('falls back to DEFAULT_YEAR when selectedYear is unrecognised', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: 'bad-year',
      }, ['CookieConsent=preferences%3Atrue']);
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`selectedYear=${DEFAULT_YEAR}`),
        ])
      );
    });

    test('renders an error when the country is not found in threshold data', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Narnia',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
      expect(res.text).toContain('Country not found in the data');
    });

    test('renders an error when the exchange rate is not a number', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': 'not-a-number',
          Currency: 'Euro',
          'Earnings threshold (GBP)': '£22,000',
        },
      });
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(502);
      expect(res.text).toContain('Unexpected data format');
    });

    test('renders an error when the threshold field is missing', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': '1.15',
          Currency: 'Euro',
          // deliberately omit 'Earnings threshold (GBP)'
        },
      });
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(502);
      expect(res.text).toContain('Unexpected data format');
    });

    test('shows £0.00 repayment when salary is below the threshold', async () => {
      // Very low exchange rate → GBP salary well below £22,000 threshold
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': '0.0001',
          Currency: 'Euro',
          'Earnings threshold (GBP)': '£22,000',
        },
      });
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '10000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(200);
      expect(res.text).toContain('below the');
    });

    test('renders an error when getThresholdData throws', async () => {
      getThresholdData.mockRejectedValue(new Error('Database offline'));
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(200);
      expect(res.text).toContain('Something went wrong');
    });

    test('returns 403 when no CSRF token is supplied', async () => {
      const res = await request(app)
        .post('/calculate')
        .send({ targetCountry: 'Germany', salaryLocalCurrency: '50000', selectedPlan: 'plan1' });
      expect(res.status).toBe(403);
    });

    // ─── Postgraduate Loan (includePg) ──────────────────────────────────────

    test('calculates PGL repayment when includePg is on', async () => {
      getThresholdData.mockImplementation((plan) =>
        plan === 'planPg'
          ? Promise.resolve(PG_THRESHOLD_DATA)
          : Promise.resolve(THRESHOLD_DATA)
      );
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
        includePg: 'on',
      });
      expect(res.status).toBe(200);
    });

    test('shows £0.00 PGL repayment when salary is below PGL threshold', async () => {
      getThresholdData.mockImplementation((plan) =>
        plan === 'planPg'
          ? Promise.resolve({
              Germany: {
                'Exchange rate': '1.15',
                Currency: 'Euro',
                'Earnings threshold (GBP)': '£1,000,000', // far above any salary
              },
            })
          : Promise.resolve(THRESHOLD_DATA)
      );
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '5000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
        includePg: 'on',
      });
      expect(res.status).toBe(200);
      expect(res.text).toContain('below the Postgraduate Loan');
    });

    test('skips PGL row when country is absent from PG data', async () => {
      getThresholdData.mockImplementation((plan) =>
        plan === 'planPg'
          ? Promise.resolve({}) // no entry for Germany
          : Promise.resolve(THRESHOLD_DATA)
      );
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
        includePg: 'on',
      });
      expect(res.status).toBe(200);
    });

    test('skips PGL row when PG threshold field is missing for country', async () => {
      getThresholdData.mockImplementation((plan) =>
        plan === 'planPg'
          ? Promise.resolve({
              Germany: { 'Exchange rate': '1.15', Currency: 'Euro' }, // no threshold
            })
          : Promise.resolve(THRESHOLD_DATA)
      );
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
        includePg: 'on',
      });
      expect(res.status).toBe(200);
    });

    test('includePg cookie is stored as "false" when checkbox is absent', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
        // no includePg key → checkbox was not checked
      }, ['CookieConsent=preferences%3Atrue']);
      expect(res.headers['set-cookie']).toEqual(
        expect.arrayContaining([expect.stringContaining('includePg=false')])
      );
    });

    test('includes saved loan values in JSON calculations for logged-in users', async () => {
      const { agent } = await createProfileAgent(app, {
        loanValueGbp: 12345,
        loanValuePglGbp: 6789,
      });
      const get = await agent.get('/');
      const token = get.text.match(/name="csrfToken" value="(.+?)"/)[1];

      const res = await agent
        .post('/calculate')
        .set('Accept', 'application/json')
        .send({
          csrfToken: token,
          targetCountry: 'Germany',
          salaryLocalCurrency: '50000',
          selectedPlan: 'plan1',
          selectedYear: DEFAULT_YEAR,
        });

      expect(res.status).toBe(200);
      expect(res.body.loanValueGbp).toBe(12345);
      expect(res.body.loanValuePglGbp).toBe(6789);
    });
  });

  // ─── POST /calculate – JSON responses ───────────────────────────────────────

  describe('POST /calculate - JSON responses', () => {
    test('returns JSON repayment data on a valid request', async () => {
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(200);
      expect(res.body.monthlyRepayment).toBeDefined();
      expect(res.body.thresholdGbp).toBeDefined();
      expect(res.body.localPerGbp).toBeDefined();
      expect(res.body.salaryGbp).toBeDefined();
      expect(res.body.selectedPlan).toBe('plan1');
      expect(res.body.pglMonthlyRepayment).toBeNull();
      expect(res.body.pglThresholdGbp).toBeNull();
    });

    test('returns zero monthlyRepayment in JSON when salary is below threshold', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': '0.0001',
          Currency: 'Euro',
          'Earnings threshold (GBP)': '£22,000',
        },
      });
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '10000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(200);
      expect(res.body.monthlyRepayment).toBe('0.00');
    });

    test('includes non-null PGL fields in JSON when includePg is on', async () => {
      getThresholdData.mockImplementation((plan) =>
        plan === 'planPg'
          ? Promise.resolve(PG_THRESHOLD_DATA)
          : Promise.resolve(THRESHOLD_DATA)
      );
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
        includePg: 'on',
      });
      expect(res.status).toBe(200);
      expect(res.body.pglMonthlyRepayment).not.toBeNull();
      expect(res.body.pglThresholdGbp).not.toBeNull();
    });

    test('returns JSON 400 for an invalid plan', async () => {
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'planX',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid repayment plan');
    });

    test('returns JSON 400 for an invalid salary', async () => {
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: 'not-a-number',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('valid positive salary');
    });

    test('returns JSON error for country not found', async () => {
      const res = await postCalculateJson(app, {
        targetCountry: 'Narnia',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Country not found');
    });

    test('returns JSON error for unexpected data format', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': 'not-a-number',
          Currency: 'Euro',
          'Earnings threshold (GBP)': '£22,000',
        },
      });
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(502);
      expect(res.body.error).toContain('Unexpected data format');
    });

    test('returns JSON 500 when getThresholdData throws', async () => {
      getThresholdData.mockRejectedValue(new Error('Database offline'));
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Something went wrong');
    });

    test('still returns a result when logCalculation throws', async () => {
      getThresholdData.mockResolvedValue(THRESHOLD_DATA);
      const spy = jest.spyOn(db, 'logCalculation').mockImplementation(() => { throw new Error('db locked'); });

      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });

      expect(res.status).toBe(200);
      expect(res.body.monthlyRepayment).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to log calculation'));

      spy.mockRestore();
    });
  });
});
