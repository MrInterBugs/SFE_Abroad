'use strict';

const { parseGbpAmount } = require('../utils/seoGuideBuilder');

describe('seoGuideBuilder', () => {
  test('parses GBP strings and rejects non-string values', () => {
    expect(parseGbpAmount('£12,345')).toBe(12345);
    expect(Number.isNaN(parseGbpAmount(null))).toBe(true);
  });
});
