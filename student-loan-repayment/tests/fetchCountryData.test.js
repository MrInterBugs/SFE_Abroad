'use strict';

// Mocks must be declared before any require() calls.
// jest.mock() is hoisted automatically; the factory runs fresh after each
// jest.resetModules() call in beforeEach so the module cache (cache/cacheTimestamp)
// is cleared between tests.
jest.mock('axios');
jest.mock('../utils/logger', () => ({
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

describe('fetchCountryData module', () => {
  let axios, db, getThresholdData, fetchCountryData;

  beforeEach(() => {
    // Reset the module registry so each test starts with an empty in-memory cache.
    jest.resetModules();

    axios = require('axios');
    db = require('../utils/db');

    // Default mock behaviours — individual tests override as needed.
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
    });

    test('returns DB data for an archived year without going to gov.uk', async () => {
      const dbData = {
        Germany: { 'Exchange rate': '1.0', Currency: 'Euro', 'Earnings threshold (GBP)': '£20,000' },
      };
      db.loadThresholds.mockReturnValue(dbData);

      const result = await getThresholdData('plan1', ARCHIVED_YEAR);

      expect(result).toBe(dbData);
      expect(axios.get).not.toHaveBeenCalled();
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

      await fetchCountryData('plan2', DEFAULT_YEAR);
      await fetchCountryData('plan2', DEFAULT_YEAR);

      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('returns DB country list for an archived year without web fetch', async () => {
      db.loadCountryList.mockReturnValue(['France', 'Germany']);

      const result = await fetchCountryData('plan1', ARCHIVED_YEAR);

      expect(result).toEqual(['France', 'Germany']);
      expect(axios.get).not.toHaveBeenCalled();
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
