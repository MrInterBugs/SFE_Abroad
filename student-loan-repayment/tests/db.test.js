'use strict';

const { saveThresholds, loadThresholds, loadCountryList } = require('../utils/db');

// Each test run gets a unique plan/year key so repeated runs (and parallel
// Jest workers) never collide with each other or with prefetched real data.
const RUN_ID = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const PLAN = `plan_${RUN_ID}`;
const YEAR = `year_${RUN_ID}`;

const SAMPLE_DATA = {
  Germany: {
    'Exchange rate': '1.15',
    Currency: 'Euro',
    'Earnings threshold (GBP)': '£22,000',
  },
  France: {
    'Exchange rate': '1.15',
    Currency: 'Euro',
    'Earnings threshold (GBP)': '£22,000',
  },
};

describe('db', () => {
  test('loadThresholds returns null for an unknown plan/year', () => {
    expect(loadThresholds(`unknown_${RUN_ID}`, 'no-such-year')).toBeNull();
  });

  test('loadCountryList returns an empty array for an unknown plan/year', () => {
    expect(loadCountryList(`unknown2_${RUN_ID}`, 'no-such-year')).toEqual([]);
  });

  test('saveThresholds persists data that loadThresholds can retrieve', () => {
    saveThresholds(PLAN, YEAR, SAMPLE_DATA);
    const result = loadThresholds(PLAN, YEAR);
    expect(result).toEqual(SAMPLE_DATA);
  });

  test('loadCountryList returns alphabetically sorted country names after a save', () => {
    // Data was written by the previous test; tests in a single file are sequential.
    const result = loadCountryList(PLAN, YEAR);
    expect(result).toEqual(['France', 'Germany']);
  });

  test('saveThresholds with INSERT OR REPLACE updates an existing row', () => {
    const updated = {
      Germany: {
        'Exchange rate': '1.99',
        Currency: 'Euro',
        'Earnings threshold (GBP)': '£25,000',
      },
    };
    saveThresholds(PLAN, YEAR, updated);

    const result = loadThresholds(PLAN, YEAR);
    expect(result['Germany']['Exchange rate']).toBe('1.99');
    // France row from the earlier save should still be present
    expect(result['France']).toBeDefined();
  });

  test('saveThresholds with an empty dict completes without error', () => {
    const emptyPlan = `empty_${RUN_ID}`;
    expect(() => saveThresholds(emptyPlan, YEAR, {})).not.toThrow();
    // Nothing stored → null
    expect(loadThresholds(emptyPlan, YEAR)).toBeNull();
  });
});
