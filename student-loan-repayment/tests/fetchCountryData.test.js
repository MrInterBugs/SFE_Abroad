'use strict';

// Mocks must be declared before any require() calls.
// jest.mock() is hoisted automatically; the factory runs fresh after each
// jest.resetModules() call in beforeEach so the module cache (cache/cacheTimestamp)
// is cleared between tests.
jest.mock('axios');
jest.mock('fs', () => ({ readFileSync: jest.fn(() => '{}') }));
jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../utils/db', () => ({
  saveThresholds: jest.fn(),
  loadThresholds: jest.fn(),
  loadCountryList: jest.fn(),
}));

// Constants are stable — read them once outside the reset cycle.
const { DEFAULT_YEAR } = require('../config/constants');
// Pick any year that is NOT DEFAULT_YEAR to exercise the "archived year" paths.
const ARCHIVED_YEAR = '2025-26';

// Minimal HTML that cheerio can parse into a table with one real country row
// and one empty row (to exercise the `if (!countryName) return` guard).
const SAMPLE_HTML = `
<html><body>
<table>
  <tr>
    <th>Country</th>
    <th>Exchange rate</th>
    <th>Currency</th>
    <th>Earnings threshold (GBP)</th>
  </tr>
  <tr><td>Germany</td><td>1.15</td><td>Euro</td><td>£22,000</td></tr>
  <tr><td></td><td></td><td></td><td></td></tr>
</table>
</body></html>
`;

// HTML that produces an empty country dict (all rows have an empty first cell).
const EMPTY_TABLE_HTML = `
<html><body>
<table>
  <tr><th>Country</th><th>Exchange rate</th></tr>
  <tr><td></td><td></td></tr>
</table>
</body></html>
`;

// HTML with rows but the Exchange rate column has been renamed.
const MISSING_EXCHANGE_RATE_HTML = `
<html><body>
<table>
  <tr>
    <th>Country</th>
    <th>Local rate</th>
    <th>Earnings threshold (GBP)</th>
  </tr>
  <tr><td>Germany</td><td>1.15</td><td>£22,000</td></tr>
</table>
</body></html>
`;

// HTML with rows but the plan-specific threshold column has been renamed.
const MISSING_THRESHOLD_HTML = `
<html><body>
<table>
  <tr>
    <th>Country</th>
    <th>Exchange rate</th>
    <th>Some other field</th>
  </tr>
  <tr><td>Germany</td><td>1.15</td><td>something</td></tr>
</table>
</body></html>
`;

// HTML where the first country row is valid but a later row is missing data.
const PARTIAL_MISSING_THRESHOLD_HTML = `
<html><body>
<table>
  <tr>
    <th>Country</th>
    <th>Exchange rate</th>
    <th>Earnings threshold (GBP)</th>
  </tr>
  <tr><td>Germany</td><td>1.15</td><td>£22,000</td></tr>
  <tr><td>France</td><td>1.1</td></tr>
</table>
</body></html>
`;

describe('fetchCountryData module', () => {
  let axios, fs, db, logger, getThresholdData, fetchCountryData;

  beforeEach(() => {
    // Reset the module registry so each test starts with an empty in-memory cache.
    jest.resetModules();

    axios = require('axios');
    fs = require('fs');
    db = require('../utils/db');
    logger = require('../utils/logger');

    // Default mock behaviours — individual tests override as needed.
    fs.readFileSync.mockReturnValue('{}');
    db.saveThresholds.mockImplementation(() => {});
    db.loadThresholds.mockReturnValue(null);
    db.loadCountryList.mockReturnValue([]);

    ({ getThresholdData, fetchCountryData } = require('../utils/fetchCountryData'));
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getThresholdData ───────────────────────────────────────────────────────

  describe('getThresholdData', () => {
    test('fetches from gov.uk and saves to DB on a cache miss', async () => {
      axios.get.mockResolvedValue({ status: 200, data: SAMPLE_HTML });

      const result = await getThresholdData('plan1', DEFAULT_YEAR);

      expect(result).toHaveProperty('Germany');
      expect(result['Germany']['Exchange rate']).toBe('1.15');
      expect(db.saveThresholds).toHaveBeenCalledWith('plan1', DEFAULT_YEAR, expect.objectContaining({ Germany: expect.any(Object) }));
    });

    test('returns the in-memory cached object on a second call (no extra web fetch)', async () => {
      axios.get.mockResolvedValue({ status: 200, data: SAMPLE_HTML });

      const first = await getThresholdData('plan1', DEFAULT_YEAR);
      const second = await getThresholdData('plan1', DEFAULT_YEAR);

      // Same object reference means it came from the in-memory cache.
      expect(second).toBe(first);
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(`Memory cache hit: plan1 ${DEFAULT_YEAR}`);
    });

    test('returns DB data for an archived year without going to gov.uk', async () => {
      const dbData = {
        Germany: { 'Exchange rate': '1.0', Currency: 'Euro', 'Earnings threshold (GBP)': '£20,000' },
      };
      db.loadThresholds.mockReturnValue(dbData);

      const result = await getThresholdData('plan1', ARCHIVED_YEAR);

      expect(result).toBe(dbData);
      expect(axios.get).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(`DB cache hit (archived year): plan1 ${ARCHIVED_YEAR}`);
    });

    test('fetches from web for an archived year when the DB is empty', async () => {
      db.loadThresholds.mockReturnValue(null);
      axios.get.mockResolvedValue({ status: 200, data: SAMPLE_HTML });

      const result = await getThresholdData('plan1', ARCHIVED_YEAR);

      expect(result).toHaveProperty('Germany');
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('falls back to DB when gov.uk fetch fails', async () => {
      const dbData = { Germany: { 'Exchange rate': '1.0', Currency: 'Euro' } };
      db.loadThresholds.mockReturnValue(dbData);
      axios.get.mockRejectedValue(new Error('Network error'));

      const result = await getThresholdData('plan1', DEFAULT_YEAR);

      expect(result).toBe(dbData);
    });

    test('throws when gov.uk fails and DB is also unavailable', async () => {
      db.loadThresholds.mockReturnValue(null);
      axios.get.mockRejectedValue(new Error('Network error'));

      await expect(getThresholdData('plan1', DEFAULT_YEAR))
        .rejects.toThrow('Data unavailable');
    });

    test('throws when gov.uk returns a non-200 status', async () => {
      db.loadThresholds.mockReturnValue(null);
      axios.get.mockResolvedValue({ status: 503, data: '' });

      await expect(getThresholdData('plan1', DEFAULT_YEAR))
        .rejects.toThrow('Data unavailable');
    });

    test('throws when the parsed HTML table contains no country rows', async () => {
      db.loadThresholds.mockReturnValue(null);
      axios.get.mockResolvedValue({ status: 200, data: EMPTY_TABLE_HTML });

      await expect(getThresholdData('plan1', DEFAULT_YEAR))
        .rejects.toThrow('Data unavailable');
    });

    test('throws when the Exchange rate column is missing from parsed data', async () => {
      db.loadThresholds.mockReturnValue(null);
      axios.get.mockResolvedValue({ status: 200, data: MISSING_EXCHANGE_RATE_HTML });

      await expect(getThresholdData('plan1', DEFAULT_YEAR))
        .rejects.toThrow('Data unavailable');
    });

    test('throws when the plan threshold column is missing from parsed data', async () => {
      db.loadThresholds.mockReturnValue(null);
      axios.get.mockResolvedValue({ status: 200, data: MISSING_THRESHOLD_HTML });

      await expect(getThresholdData('plan1', DEFAULT_YEAR))
        .rejects.toThrow('Data unavailable');
    });

    test('throws when a later country row is missing a required column', async () => {
      db.loadThresholds.mockReturnValue(null);
      axios.get.mockResolvedValue({ status: 200, data: PARTIAL_MISSING_THRESHOLD_HTML });

      await expect(getThresholdData('plan1', DEFAULT_YEAR))
        .rejects.toThrow('Data unavailable');
    });

    test('returns override data and skips gov.uk when an entry exists in overrides.json', async () => {
      const overrideData = {
        Germany: { 'Exchange rate': '1.2', Currency: 'Euro', 'Earnings threshold (GBP)': '£25,000' },
      };
      fs.readFileSync.mockReturnValue(JSON.stringify({ [`plan1:${DEFAULT_YEAR}`]: overrideData }));

      const result = await getThresholdData('plan1', DEFAULT_YEAR);

      expect(result).toStrictEqual(overrideData);
      expect(axios.get).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Override in use'));
    });

    test('throws when override data is missing required columns', async () => {
      const overrideData = {
        Germany: { 'Exchange rate': '1.2', Currency: 'Euro', 'Earnings threshold (GBP)': '£25,000' },
        France: { Currency: 'Euro', 'Earnings threshold (GBP)': '£24,000' },
      };
      fs.readFileSync.mockReturnValue(JSON.stringify({ [`plan1:${DEFAULT_YEAR}`]: overrideData }));

      await expect(getThresholdData('plan1', DEFAULT_YEAR))
        .rejects.toThrow('Expected "Exchange rate" column not found for France in overrides.json for plan1');
      expect(axios.get).not.toHaveBeenCalled();
      expect(db.loadThresholds).not.toHaveBeenCalled();
    });

    test('throws when override data has an invalid shape', async () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({ [`plan1:${DEFAULT_YEAR}`]: [] }));

      await expect(getThresholdData('plan1', DEFAULT_YEAR))
        .rejects.toThrow('Invalid overrides.json for plan1');
      expect(axios.get).not.toHaveBeenCalled();
      expect(db.loadThresholds).not.toHaveBeenCalled();
    });

    test.each([
      ['null data', null, 'Invalid overrides.json for plan1'],
      ['string data', 'bad data', 'Invalid overrides.json for plan1'],
      ['null country row', { Germany: null }, 'Invalid row for Germany in overrides.json for plan1'],
      ['string country row', { Germany: 'bad row' }, 'Invalid row for Germany in overrides.json for plan1'],
      ['array country row', { Germany: [] }, 'Invalid row for Germany in overrides.json for plan1'],
      [
        'blank exchange rate',
        { Germany: { 'Exchange rate': ' ', Currency: 'Euro', 'Earnings threshold (GBP)': '£25,000' } },
        'Expected "Exchange rate" column not found for Germany in overrides.json for plan1',
      ],
      [
        'blank threshold',
        { Germany: { 'Exchange rate': '1.2', Currency: 'Euro', 'Earnings threshold (GBP)': ' ' } },
        'Expected "Earnings threshold (GBP)" column not found for Germany in overrides.json for plan1',
      ],
    ])('throws when override data has %s', async (_label, overrideData, message) => {
      fs.readFileSync.mockReturnValue(JSON.stringify({ [`plan1:${DEFAULT_YEAR}`]: overrideData }));

      await expect(getThresholdData('plan1', DEFAULT_YEAR)).rejects.toThrow(message);
      expect(axios.get).not.toHaveBeenCalled();
      expect(db.loadThresholds).not.toHaveBeenCalled();
    });

    test('allows override data without a threshold column for unknown plans', async () => {
      const overrideData = {
        Germany: { 'Exchange rate': '1.2', Currency: 'Euro' },
      };
      fs.readFileSync.mockReturnValue(JSON.stringify({ [`unknownPlan:${DEFAULT_YEAR}`]: overrideData }));

      const result = await getThresholdData('unknownPlan', DEFAULT_YEAR);

      expect(result).toStrictEqual(overrideData);
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('falls through to normal fetch when overrides.json is corrupt', async () => {
      fs.readFileSync.mockReturnValue('not valid json {{{');
      axios.get.mockResolvedValue({ status: 200, data: SAMPLE_HTML });

      const result = await getThresholdData('plan1', DEFAULT_YEAR);

      expect(result).toHaveProperty('Germany');
    });
  });

  // ─── fetchCountryData ───────────────────────────────────────────────────────

  describe('fetchCountryData', () => {
    test('returns country names from a successful web fetch', async () => {
      axios.get.mockResolvedValue({ status: 200, data: SAMPLE_HTML });

      const result = await fetchCountryData('plan1', DEFAULT_YEAR);

      expect(result).toContain('Germany');
    });

    test('returns from in-memory cache on second call without re-fetching', async () => {
      axios.get.mockResolvedValue({ status: 200, data: SAMPLE_HTML });

      await fetchCountryData('plan1', DEFAULT_YEAR);
      await fetchCountryData('plan1', DEFAULT_YEAR);

      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('returns DB country list for an archived year without web fetch', async () => {
      db.loadCountryList.mockReturnValue(['France', 'Germany']);

      const result = await fetchCountryData('plan1', ARCHIVED_YEAR);

      expect(result).toEqual(['France', 'Germany']);
      expect(axios.get).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(`DB country list hit (archived year): plan1 ${ARCHIVED_YEAR}`);
    });

    test('falls back to full fetch for archived year when DB list is empty', async () => {
      db.loadCountryList.mockReturnValue([]);
      db.loadThresholds.mockReturnValue(null);
      axios.get.mockResolvedValue({ status: 200, data: SAMPLE_HTML });

      const result = await fetchCountryData('plan4', ARCHIVED_YEAR);

      expect(result).toContain('Germany');
      expect(axios.get).toHaveBeenCalledTimes(1);
    });
  });
});
