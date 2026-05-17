jest.mock('../utils/fetchCountryData');
jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const request = require('supertest');
const { createApp, startServer, prefetchAllData, isStaticRequest, isPrivatePage, requestLogLine, resolvePort } = require('../app');
const { getThresholdData } = require('../utils/fetchCountryData');
const logger = require('../utils/logger');
const { DEFAULT_YEAR } = require('../config/constants');

const THRESHOLD_DATA = {
  Germany: {
    'Exchange rate': '1.15',
    Currency: 'Euro',
    'Earnings threshold (GBP)': '£22,000',
    'Lower earnings threshold (GBP)': '£18,000',
    'Upper earnings threshold (GBP)': '£42,000',
  },
};

describe('Express App', () => {
  let app;

  beforeEach(() => {
    getThresholdData.mockResolvedValue(THRESHOLD_DATA);
    jest.clearAllMocks();
    app = createApp();
  });

  afterEach(() => {
    app.locals.sessionStore.close();
  });

  it('throws during startup when SESSION_SECRET is missing', () => {
    const originalSecret = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;

    jest.isolateModules(() => {
      const { createApp: createIsolatedApp } = require('../app');
      expect(() => createIsolatedApp()).toThrow('SESSION_SECRET environment variable must be set');
    });

    process.env.SESSION_SECRET = originalSecret;
  });

  it('starts the session cleanup timer outside the test environment', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let productionApp;

    try {
      productionApp = createApp();
      expect(productionApp.locals.sessionStore._cleanupInterval).toBeTruthy();
    } finally {
      productionApp?.locals.sessionStore.close();
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  // Test to check if the server is running and responds with 200
  it('should respond to GET / with a 200 status code', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
  });

  // Test to check if the server serves the static files
  it('should serve static files', async () => {
    const response = await request(app).get('/styles.css');
    expect(response.status).toBe(200);
  });

  it('serves calculator-domain.js from shared/ with a JavaScript content-type', async () => {
    const response = await request(app).get('/calculator-domain.js');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.text).toContain('PLAN_RULES');
  });

  it('should serve ads.txt from the app host', async () => {
    const response = await request(app).get('/ads.txt');
    expect(response.status).toBe(200);
    expect(response.text.trim()).toBe('google.com, pub-4989908161831974, DIRECT, f08c47fec0942fa0');
  });

  it('identifies static request paths', () => {
    expect(isStaticRequest({ method: 'GET', path: '/styles.css' })).toBe(true);
    expect(isStaticRequest({ method: 'HEAD', path: '/fonts/fonts.css' })).toBe(true);
    expect(isStaticRequest({ method: 'GET', path: '/vendor/chart.js/chart.umd.min.js' })).toBe(true);
    expect(isStaticRequest({ method: 'POST', path: '/styles.css' })).toBe(false);
    expect(isStaticRequest({ method: 'GET', path: '/' })).toBe(false);
  });

  it('resolves configured ports with a safe default', () => {
    expect(resolvePort()).toBe(3000);
    expect(resolvePort('0')).toBe(0);
    expect(resolvePort('8080')).toBe(8080);
    expect(resolvePort('not-a-port')).toBe(3000);
  });

  it('identifies account pages as private for marketing scripts', () => {
    expect(isPrivatePage({ method: 'GET', path: '/profile' })).toBe(true);
    expect(isPrivatePage({ method: 'GET', path: '/profile/export' })).toBe(true);
    expect(isPrivatePage({ method: 'GET', path: '/login' })).toBe(true);
    expect(isPrivatePage({ method: 'GET', path: '/reset-password/token' })).toBe(true);
    expect(isPrivatePage({ method: 'POST', path: '/' })).toBe(true);
    expect(isPrivatePage({ method: 'GET', path: '/' })).toBe(false);
    expect(isPrivatePage({ method: 'GET', path: '/privacy' })).toBe(false);
    expect(isPrivatePage({ method: 'GET', path: '/terms' })).toBe(false);
    expect(isPrivatePage({ method: 'GET', path: '/impressum' })).toBe(false);
    expect(isPrivatePage({ method: 'GET', path: '/about' })).toBe(false);
    expect(isPrivatePage({ method: 'GET', path: '/overseas-repayment-guides' })).toBe(false);
  });

  it('formats request log lines without IP addresses, user ids, or sensitive tokens', () => {
    expect(requestLogLine({
      method: 'GET',
      path: '/profile',
      url: '/profile?token=secret',
      ip: '127.0.0.1',
      session: { userId: 42 },
    }, { statusCode: 200 }, 12.34)).toBe('HTTP GET /profile 200 12.3ms');

    expect(requestLogLine({
      method: 'POST',
      url: '/calculate',
      ip: '127.0.0.1',
      session: {},
    }, { statusCode: 400 }, 1)).toBe('HTTP POST /calculate 400 1.0ms');

    expect(requestLogLine({
      method: 'GET',
      path: '/reset-password/secret-token',
      ip: '127.0.0.1',
    }, { statusCode: 200 }, 3)).toBe('HTTP GET /reset-password/:token 200 3.0ms');

    expect(requestLogLine({
      method: 'GET',
      path: '/confirm-email/secret-token',
      ip: '127.0.0.1',
    }, { statusCode: 200 }, 3)).toBe('HTTP GET /confirm-email/:token 200 3.0ms');

    expect(requestLogLine({
      method: 'GET',
      ip: '127.0.0.1',
    }, { statusCode: 404 }, 0)).toBe('HTTP GET / 404 0.0ms');
  });

  it('loads Cookiebot on public pages but not private account pages', async () => {
    const privacy = await request(app).get('/privacy');
    const login = await request(app).get('/login');

    expect(privacy.status).toBe(200);
    expect(privacy.text).toMatch(/<script id="Cookiebot" nonce="[^"]+"/);
    expect(privacy.text).toContain('data-framework="TCFv2.2"');
    expect(privacy.text).toContain('window.gtag_enable_tcf_support = true');
    expect(login.status).toBe(200);
    expect(login.text).not.toContain('id="Cookiebot"');
  });

  it('adds nonce-backed marketing scripts and CSP sources only on public pages', async () => {
    const home = await request(app).get('/');
    const login = await request(app).get('/login');
    const publicCsp = home.headers['content-security-policy'];
    const privateCsp = login.headers['content-security-policy'];

    expect(home.status).toBe(200);
    expect(home.text).toMatch(/<script async nonce="[^"]+" src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-4989908161831974"/);
    expect(publicCsp).toContain('https://pagead2.googlesyndication.com');
    expect(publicCsp).toContain('https://consent.cookiebot.com');
    expect(publicCsp).toContain('https://static.cloudflareinsights.com');

    expect(login.status).toBe(200);
    expect(login.text).not.toContain('adsbygoogle.js');
    expect(privateCsp).not.toContain('https://pagead2.googlesyndication.com');
    expect(privateCsp).not.toContain('https://consent.cookiebot.com');
    expect(privateCsp).not.toContain('https://static.cloudflareinsights.com');
  });

  it('should not rate limit static asset paths', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => request(app).get('/styles.css'))
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
  });

  it('should not rate limit static-looking paths that fall through static serving', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => request(app).get('/missing.css'))
    );

    expect(responses.every((r) => r.status === 404)).toBe(true);
  });

  // Test to check if cookies are being set, with CSRF token support
  it('should set selectedPlan and selectedCountry cookies on POST /calculate with valid CSRF token', async () => {
    // Step 1: Perform a GET request to retrieve the CSRF token
    const getResponse = await request(app)
      .get('/')
      .set('Cookie', 'CookieConsent=necessary%3Atrue');
    const csrfToken = getResponse.text.match(/name="csrfToken" value="(.+?)"/)[1];

    // Step 2: Use the CSRF token in the POST request
    const postResponse = await request(app)
      .post('/calculate')
      .set('Cookie', [...getResponse.headers['set-cookie'], 'CookieConsent=necessary%3Atrue%2Cpreferences%3Atrue'])
      .send({
        targetCountry: 'Germany',
        salaryLocalCurrency: 50000,
        selectedPlan: 'plan1',
        selectedYear: DEFAULT_YEAR,
        csrfToken  // Include the CSRF token in the form data
      });

    // Step 3: Check for correct status and cookies
    expect(postResponse.status).toBe(200);
    expect(postResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('selectedPlan=plan1'),
        expect.stringContaining('selectedCountry=Germany'),
        expect.stringContaining(`selectedYear=${DEFAULT_YEAR}`)
      ])
    );
  });

  it('should not set csrfToken or connect.sid on anonymous GET / before necessary consent', async () => {
    const response = await request(app).get('/');
    const setCookie = (response.headers['set-cookie'] || []).join(';');

    expect(setCookie).not.toContain('csrfToken=');
    expect(setCookie).not.toContain('connect.sid=');
  });

  // Test for error cases
  it('should respond with a 404 status code for non-existing routes', async () => {
    const response = await request(app).get('/non-existent-route');
    expect(response.status).toBe(404);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^HTTP GET \/non-existent-route 404 \d+\.\dms$/)
    );
  });

  // Rate-limiter: 15 concurrent requests from the same IP must trigger 429.
  // A 1.1 s pause beforehand ensures points from the earlier sequential tests
  // have fully replenished so this test is self-contained.
  describe('rate limiting', () => {
    beforeAll(() => new Promise((resolve) => setTimeout(resolve, 1100)));

    it('should return 429 when more than 15 requests/second arrive from one IP', async () => {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => request(app).get('/'))
      );
      expect(responses.some((r) => r.status === 429)).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded: method=GET path=/')
      );
    });
  });

  // prefetchAllData catch branch (app.js line 71):
  // Spy on getThresholdData so one call throws, then invoke prefetchAllData
  // directly — no second server is started so there is no port conflict.
  describe('prefetchAllData error handling', () => {
    it('prefetches every supported year including postgraduate loan data', async () => {
      getThresholdData.mockResolvedValue(THRESHOLD_DATA);

      await prefetchAllData();

      expect(getThresholdData).toHaveBeenCalledWith('planPg', expect.any(String));
      expect(getThresholdData).not.toHaveBeenCalledWith('plan4', '2024-25');
      expect(getThresholdData).not.toHaveBeenCalledWith('plan5', '2024-25');
      expect(getThresholdData).not.toHaveBeenCalledWith('planPg', '2024-25');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Prefetch complete')
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Prefetch skipped: plan4 2024-25 — no public source URL configured'
      );
    });

    it('logs a warning when getThresholdData rejects', async () => {
      getThresholdData.mockRejectedValue(new Error('mock failure'));

      await prefetchAllData();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Prefetch failed')
      );

    });
  });

  describe('startServer', () => {
    it('starts the HTTP server and triggers prefetch', async () => {
      getThresholdData.mockResolvedValue(THRESHOLD_DATA);
      const originalPort = process.env.PORT;
      process.env.PORT = '0';
      let serverApp;
      let server;

      try {
        ({ app: serverApp, server } = startServer());

        await new Promise((resolve) => server.once('listening', resolve));
        await new Promise((resolve) => setImmediate(resolve));

        expect(logger.info).toHaveBeenCalledWith(
          expect.stringMatching(/^Server running at http:\/\/localhost:\d+$/)
        );
        expect(getThresholdData).toHaveBeenCalled();
      } finally {
        if (server?.listening) {
          await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          });
        }
        serverApp?.locals.sessionStore.close();
        if (originalPort === undefined) {
          delete process.env.PORT;
        } else {
          process.env.PORT = originalPort;
        }
      }
    });
  });
});
