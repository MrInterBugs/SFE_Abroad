'use strict';

const {
  getCurrentTaxYear,
  SUPPORTED_YEARS,
  DEFAULT_YEAR,
  ALLOWED_PLANS,
  REPAYMENT_RATE,
  PGL_REPAYMENT_RATE,
  MONTHS_PER_YEAR,
  CACHE_DURATION,
  COOKIE_MAX_AGE,
  CACHE_PLANS,
} = require('../config/constants');
const {
  SITE_URL,
  PLAN_PAGES,
  COUNTRY_PAGES,
  SEO_PAGES,
  STATIC_INDEXABLE_PAGES,
  getSeoPage,
  getSeoPagePaths,
  getSitemapEntries,
} = require('../config/seoPages');

describe('constants — exported values', () => {
  test('REPAYMENT_RATE is 9%', () => expect(REPAYMENT_RATE).toBe(0.09));
  test('PGL_REPAYMENT_RATE is 6%', () => expect(PGL_REPAYMENT_RATE).toBe(0.06));
  test('MONTHS_PER_YEAR is 12', () => expect(MONTHS_PER_YEAR).toBe(12));
  test('CACHE_DURATION is 7 days in ms', () =>
    expect(CACHE_DURATION).toBe(7 * 24 * 60 * 60 * 1000));
  test('COOKIE_MAX_AGE is 30 days in ms', () =>
    expect(COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60 * 1000));

  test('ALLOWED_PLANS contains all four plans', () => {
    expect(ALLOWED_PLANS).toEqual(['plan1', 'plan2', 'plan4', 'plan5']);
  });

  test('CACHE_PLANS includes undergraduate and postgraduate cache sources', () => {
    expect(CACHE_PLANS).toEqual(['plan1', 'plan2', 'plan4', 'plan5', 'planPg']);
  });

  test('SUPPORTED_YEARS is non-empty', () => {
    expect(SUPPORTED_YEARS.length).toBeGreaterThan(0);
  });

  test('DEFAULT_YEAR is the last element of SUPPORTED_YEARS', () => {
    expect(DEFAULT_YEAR).toBe(SUPPORTED_YEARS[SUPPORTED_YEARS.length - 1]);
  });
});

describe('getCurrentTaxYear', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('returns previous tax year when date is before 6 April', () => {
    // 5 April 2026 → still in the 2025-26 tax year
    jest.setSystemTime(new Date('2026-04-05T12:00:00'));
    expect(getCurrentTaxYear()).toBe('2025-26');
  });

  test('returns current tax year on exactly 6 April', () => {
    // 6 April 2026 → first day of 2026-27 tax year
    jest.setSystemTime(new Date('2026-04-06T00:00:00'));
    expect(getCurrentTaxYear()).toBe('2026-27');
  });

  test('returns current tax year well after 6 April', () => {
    jest.setSystemTime(new Date('2026-12-25T12:00:00'));
    expect(getCurrentTaxYear()).toBe('2026-27');
  });

  test('returns previous tax year in January (before next April)', () => {
    // January 2026 → still 2025-26
    jest.setSystemTime(new Date('2026-01-15T00:00:00'));
    expect(getCurrentTaxYear()).toBe('2025-26');
  });

  test('falls back to DEFAULT_YEAR when computed year is not in SUPPORTED_YEARS', () => {
    // Far-future date: computed year will be something like '2099-00', not supported
    jest.setSystemTime(new Date('2099-07-01T00:00:00'));
    expect(getCurrentTaxYear()).toBe(DEFAULT_YEAR);
  });
});

describe('SEO page configuration', () => {
  test('exports canonical site URL and page lists', () => {
    expect(SITE_URL).toBe('https://sfe.aedanl.com');
    expect(PLAN_PAGES.length).toBe(5);
    expect(COUNTRY_PAGES.length).toBe(17);
    expect(SEO_PAGES).toHaveLength(PLAN_PAGES.length + COUNTRY_PAGES.length);
    expect(STATIC_INDEXABLE_PAGES.map((page) => page.path)).toEqual(['/', '/methodology', '/about']);
  });

  test('finds configured pages by slug and returns null for misses', () => {
    expect(getSeoPage('plan-2-overseas-repayment').plan).toBe('Plan 2');
    expect(getSeoPage('student-loan-overseas-repayment-germany').country).toBe('Germany');
    expect(getSeoPage('missing-page')).toBeNull();
  });

  test('derives route paths and sitemap entries from configured SEO pages', () => {
    expect(getSeoPagePaths()).toContain('/plan-2-overseas-repayment');
    expect(getSeoPagePaths()).toContain('/student-loan-overseas-repayment-germany');
    expect(getSeoPagePaths()).toHaveLength(SEO_PAGES.length);

    const entries = getSitemapEntries('2026-05-04');
    expect(entries).toHaveLength(STATIC_INDEXABLE_PAGES.length + SEO_PAGES.length);
    expect(entries).toContainEqual({
      loc: 'https://sfe.aedanl.com/',
      lastmod: '2026-05-04',
      changefreq: 'monthly',
      priority: '1.0',
    });
    expect(entries).toContainEqual({
      loc: 'https://sfe.aedanl.com/student-loan-overseas-repayment-germany',
      lastmod: '2026-05-04',
      changefreq: 'monthly',
      priority: '0.9',
    });
  });
});
