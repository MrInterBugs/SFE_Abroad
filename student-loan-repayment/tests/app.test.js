const request = require('supertest');
const { app, server, prefetchAllData } = require('../app');

describe('Express App', () => {
  afterAll((done) => {
    server.close(done);
  });

  it('throws during startup when SESSION_SECRET is missing', () => {
    const originalSecret = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;

    jest.isolateModules(() => {
      expect(() => require('../app')).toThrow('SESSION_SECRET environment variable must be set');
    });

    process.env.SESSION_SECRET = originalSecret;
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

  it('should serve ads.txt from the app host', async () => {
    const response = await request(app).get('/ads.txt');
    expect(response.status).toBe(200);
    expect(response.text.trim()).toBe('google.com, pub-4989908161831974, DIRECT, f08c47fec0942fa0');
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
        csrfToken  // Include the CSRF token in the form data
      });

    // Step 3: Check for correct status and cookies
    expect(postResponse.status).toBe(200);
    expect(postResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('selectedPlan=plan1'),
        expect.stringContaining('selectedCountry=Germany')
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
    });
  });

  // prefetchAllData catch branch (app.js line 71):
  // Spy on getThresholdData so one call throws, then invoke prefetchAllData
  // directly — no second server is started so there is no port conflict.
  describe('prefetchAllData error handling', () => {
    it('logs a warning when getThresholdData rejects', async () => {
      const fetchModule = require('../utils/fetchCountryData');
      const logger = require('../utils/logger');

      jest.spyOn(fetchModule, 'getThresholdData').mockRejectedValue(new Error('mock failure'));
      jest.spyOn(logger, 'warn');

      await prefetchAllData();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Prefetch failed')
      );

      jest.restoreAllMocks();
    });
  });
});
