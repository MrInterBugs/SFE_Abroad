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
    'Upper earnings threshold (GBP)': '£35,000',
  },
  Germany: {
    'Exchange rate': '1.15',
    Currency: 'Euro',
    'Earnings threshold (GBP)': '£22,000',
    'Lower earnings threshold (GBP)': '£18,000',
    'Upper earnings threshold (GBP)': '£42,000',
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
 * Like postCalculate but also sends Accept: application/json. /calculate is
 * JSON-only; this helper preserves coverage for explicit JSON clients.
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

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

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
      expect(res.text).toContain('Preference cookies are only set after you give preference consent');
      expect(res.text).toContain('<strong>Preference cookies</strong> &mdash; 30 days, if you give preference consent');
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

    test('GET /overseas-repayment-guides renders an indexable guide hub', async () => {
      const res = await request(app).get('/overseas-repayment-guides');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<link rel="canonical" href="https://sfe.aedanl.com/overseas-repayment-guides">');
      expect(res.text).toContain('Popular country guides');
      expect(res.text).toContain('Repayment plan guides');
      expect(res.text).toContain('All country guides');
      expect(res.text).toContain('/student-loan-overseas-repayment-germany');
      expect(res.text).toContain('/plan-2-overseas-repayment');
      expect(res.text).not.toContain('noindex');
    });

    test('GET plan SEO landing page renders with canonical metadata', async () => {
      const res = await request(app).get('/plan-2-overseas-repayment');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Plan 2 Overseas Student Loan Repayment');
      expect(res.text).toContain('<link rel="canonical" href="https://sfe.aedanl.com/plan-2-overseas-repayment">');
      expect(res.text).toContain('BreadcrumbList');
      expect(res.text).toContain('Who usually uses Plan 2?');
      expect(res.text).toContain('Before calculating');
      expect(res.text).toContain('Frequently asked questions');
      expect(res.text).toContain('Is Plan 2 repaid at the same rate when I live overseas?');
      expect(res.text).toContain('This page was last reviewed on 8 May 2026');
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
      expect(res.text).toContain('Local salary currency');
      expect(res.text).toContain('GBP threshold range');
      expect(res.text).toContain('<td>Plan 1</td>');
      expect(res.text).toContain('<td>£22,000</td>');
      expect(res.text).toContain('<td>€19,130</td>');
      expect(res.text).toContain('Worked repayment example');
      expect(res.text).toContain('about €27,826');
      expect(res.text).toContain('about £75 per month');
      expect(res.text).toContain('Use your gross annual euro salary before German income tax');
      expect(res.text).toContain('Sample EUR salary estimates');
      expect(res.text).toContain('<td>€30,000</td>');
      expect(res.text).toContain('<td>£34,500</td>');
      expect(res.text).toContain('<td>£124</td>');
      expect(res.text).toContain('Common mistakes to avoid');
      expect(res.text).toContain('Entering monthly take-home pay instead of annual gross EUR income.');
      expect(res.text).toContain('Frequently asked questions');
      expect(res.text).toContain('Should I use gross or take-home pay in Germany?');
      expect(res.text).toContain('"@type":"FAQPage"');
      expect(res.text).toContain('Source note: thresholds and exchange rates are based on public GOV.UK');
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

    test('GET country SEO landing page formats local thresholds without a known currency code', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': '2',
          Currency: 'Test Credits',
          'Earnings threshold (GBP)': '£22,000',
          'Lower earnings threshold (GBP)': '£18,000',
        },
      });
      const res = await request(app).get('/student-loan-overseas-repayment-germany');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<td>11,000</td>');
      expect(res.text).toContain('about 16,000');
    });

    test('GET country SEO landing page tolerates unparseable threshold examples', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': '2',
          'Earnings threshold (GBP)': 'not published',
          'Lower earnings threshold (GBP)': 'not published',
        },
      });
      const res = await request(app).get('/student-loan-overseas-repayment-germany');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<td>not published</td>');
      expect(res.text).toContain('<td>n/a</td>');
      expect(res.text).not.toContain('Worked repayment example');
    });

    test('GET country SEO landing page uses another plan for sample salaries when Plan 2 is unavailable', async () => {
      getThresholdData.mockImplementation((plan) => {
        if (plan === 'plan2') return Promise.resolve({});
        return Promise.resolve(THRESHOLD_DATA);
      });
      const res = await request(app).get('/student-loan-overseas-repayment-germany');
      expect(res.status).toBe(200);
      expect(res.text).toContain('The examples below use Plan 1');
      expect(res.text).toContain('<td>€30,000</td>');
    });

    test('renders the index page with a 200', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('csrfToken');
      expect(res.text).toContain('id="calc-error"');
      expect(res.text).toContain('UK Student Loan Overseas Repayment Calculator');
      expect(res.text).toContain('/overseas-repayment-guides');
      expect(res.text).toContain('/student-loan-overseas-repayment-germany');
      expect(res.text).toContain('/plan-2-overseas-repayment');
      expect(res.text).toContain('What to check before estimating');
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

    test('ignores preference cookies before preference consent', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['selectedPlan=plan2', 'selectedCountry=Germany', 'includePg=true']);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/id="plan1" value="plan1" checked/);
      expect(res.text).toContain('name="targetCountry" placeholder="e.g. Germany, Australia, Canada…" autocomplete="off" value=""');
      expect(res.text).toMatch(/id="pgl-check" name="includePg"\s*>/);
    });

    test('reads a valid selectedPlan cookie (plan2) after preference consent', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['CookieConsent=preferences%3Atrue', 'selectedPlan=plan2']);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/id="plan2" value="plan2" checked/);
    });

    test('ignores an invalid selectedPlan cookie and defaults to plan1', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['CookieConsent=preferences%3Atrue', 'selectedPlan=planX']);
      expect(res.status).toBe(200);
    });

    test('reads a valid selectedYear cookie', async () => {
      const archivedYear = SUPPORTED_YEARS[0];
      const res = await request(app)
        .get('/')
        .set('Cookie', ['CookieConsent=preferences%3Atrue', `selectedYear=${archivedYear}`]);
      expect(res.status).toBe(200);
      expect(getThresholdData).toHaveBeenCalledWith('plan1', archivedYear);
    });

    test('hides plans and PGL that are unavailable for the selected tax year', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', [
          'CookieConsent=preferences%3Atrue',
          'selectedYear=2024-25',
          'selectedPlan=plan4',
          'includePg=true',
        ]);

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/id="plan1" value="plan1" checked/);
      expect(res.text).toMatch(/data-plan="plan4" hidden/);
      expect(res.text).toMatch(/id="plan4" value="plan4"[^>]*disabled/);
      expect(res.text).toMatch(/data-plan="plan5" hidden/);
      expect(res.text).toMatch(/id="pgl-divider"[^>]*hidden/);
      expect(res.text).toMatch(/id="pgl-row"[^>]*hidden/);
      expect(res.text).toMatch(/id="pgl-check" name="includePg"[^>]*disabled/);
    });

    test('ignores an invalid selectedYear cookie and falls back to the default tax year', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['CookieConsent=preferences%3Atrue', 'selectedYear=not-a-year']);
      expect(res.status).toBe(200);
    });

    test('shows latest available data when the real current tax year is unsupported', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2027-04-06T12:00:00'));

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.text).toContain('The 2027-28 overseas thresholds are not available yet.');
      expect(res.text).toContain(`Showing latest available data: ${DEFAULT_YEAR}.`);
      expect(res.text).toMatch(new RegExp(`id="ty-${DEFAULT_YEAR.replace('-', '')}" value="${DEFAULT_YEAR}" checked`));
      expect(getThresholdData).toHaveBeenCalledWith('plan1', DEFAULT_YEAR);
    });

    test('reads includePg=true cookie', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['CookieConsent=preferences%3Atrue', 'includePg=true']);
      expect(res.status).toBe(200);
    });

    test('reads selectedCountry cookie', async () => {
      const res = await request(app)
        .get('/')
        .set('Cookie', ['CookieConsent=preferences%3Atrue', 'selectedCountry=Germany']);
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
      expect(res.text).toMatch(/id="pgl-check" name="includePg"\s*>/);
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

    test('returns 400 when selectedPlan is unavailable for the selected year', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan4',
        selectedYear: '2024-25',
      });
      expect(res.status).toBe(400);
      expect(res.text).toContain('Selected repayment plan is not available for this tax year');
    });

    test('returns 400 when PGL is unavailable for the selected year', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: '2024-25',
        includePg: 'on',
      });
      expect(res.status).toBe(400);
      expect(res.text).toContain('Postgraduate Loan data is not available for this tax year');
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

    test('returns 400 for a partially numeric salary', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000abc',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
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

    test('returns 400 when selectedYear is unrecognised', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: 'bad-year',
      }, ['CookieConsent=preferences%3Atrue']);
      const setCookie = (res.headers['set-cookie'] || []).join(';');
      expect(res.status).toBe(400);
      expect(res.text).toContain('Invalid tax year selected');
      expect(setCookie).not.toContain('selectedYear=');
    });

    test('returns an error when the country is not found in threshold data', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Narnia',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
      expect(res.text).toContain('Country not found in the data');
    });

    test('does not set preference cookies when the country is not found', async () => {
      const res = await postCalculate(app, {
        targetCountry: 'Narnia',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      }, ['CookieConsent=preferences%3Atrue']);
      const setCookie = (res.headers['set-cookie'] || []).join(';');
      expect(res.status).toBe(400);
      expect(setCookie).not.toContain('selectedCountry=Narnia');
      expect(setCookie).not.toContain('selectedPlan=plan1');
    });

    test('returns an error when the exchange rate is not a number', async () => {
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

    test('returns an error when the threshold field is missing', async () => {
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

    test('returns £0.00 repayment when salary is below the threshold', async () => {
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
      expect(res.body.monthlyRepayment).toBe('0.00');
      expect(res.body.salaryGbp).toBe('1.00');
    });

    test('returns JSON 500 when getThresholdData throws', async () => {
      getThresholdData.mockRejectedValue(new Error('Database offline'));
      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Something went wrong');
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

    test('returns £0.00 PGL repayment when salary is below PGL threshold', async () => {
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
      expect(res.body.monthlyRepayment).toBe('0.00');
      expect(res.body.pglMonthlyRepayment).toBe('0.00');
      expect(res.body.pglThresholdGbp).toBe('1000000.00');
    });

    test('returns an error when country is absent from PG data', async () => {
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
      expect(res.status).toBe(502);
      expect(res.text).toContain('Unexpected postgraduate loan data format');
    });

    test('returns an error when PG threshold field is missing for country', async () => {
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
      expect(res.status).toBe(502);
      expect(res.text).toContain('Unexpected postgraduate loan data format');
    });

    test('returns an error when PG threshold is not numeric', async () => {
      getThresholdData.mockImplementation((plan) =>
        plan === 'planPg'
          ? Promise.resolve({
              Germany: { 'Exchange rate': '1.15', Currency: 'Euro', 'Earnings threshold (GBP)': 'not-a-number' },
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
      expect(res.status).toBe(502);
      expect(res.text).toContain('Unexpected postgraduate loan data format');
    });

    test('returns an error when undergraduate threshold is not numeric', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': '1.15',
          Currency: 'Euro',
          'Earnings threshold (GBP)': 'not-a-number',
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

    test('returns an error when undergraduate threshold is not a string', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': '1.15',
          Currency: 'Euro',
          'Earnings threshold (GBP)': 22000,
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

    test('returns an error when Plan 2 upper threshold is missing', async () => {
      getThresholdData.mockResolvedValue({
        Germany: {
          'Exchange rate': '1.15',
          Currency: 'Euro',
          'Lower earnings threshold (GBP)': '£18,000',
        },
      });

      const res = await postCalculate(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan2',
        selectedYear: DEFAULT_YEAR,
      });

      expect(res.status).toBe(502);
      expect(res.text).toContain('Unexpected data format');
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

    test('includes country-specific Plan 2 interest thresholds in JSON responses', async () => {
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan2',
        selectedYear: DEFAULT_YEAR,
      });

      expect(res.status).toBe(200);
      expect(res.body.thresholdGbp).toBe('18000.00');
      expect(res.body.plan2LowerThresholdGbp).toBe('18000.00');
      expect(res.body.plan2UpperThresholdGbp).toBe('42000.00');
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

    test('returns JSON 400 for a non-string country', async () => {
      const res = await postCalculateJson(app, {
        targetCountry: ['Germany'],
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('valid country');
    });

    test('returns JSON 400 for boolean includePg', async () => {
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
        salaryLocalCurrency: '50000',
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
        includePg: true,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid Postgraduate Loan selection');
    });

    test('returns JSON 400 for a missing salary', async () => {
      const res = await postCalculateJson(app, {
        targetCountry: 'Germany',
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
