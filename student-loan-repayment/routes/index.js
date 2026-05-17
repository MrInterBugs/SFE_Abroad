const express = require('express');
const logger = require('../utils/logger');
const { verifyCsrfToken } = require('../utils/csrf');
const { getDefaultTaxYear } = require('../config/constants');
const { getThresholdData } = require('../utils/fetchCountryData');
const db = require('../utils/db');
const {
  SITE_URL,
  PLAN_PAGES,
  COUNTRY_PAGES,
  FEATURED_COUNTRY_SLUGS,
  getSeoPage,
  getSeoPagePaths,
} = require('../config/seoPages');
const { buildSeoPageViewModel } = require('../utils/seoGuideBuilder');
const legal = require('../config/legal');
const {
  COOKIE_OPTS,
  CLEAR_COOKIE_OPTS,
  hasPreferenceConsent,
  clearPreferenceCookies,
} = require('./preferenceCookies');
const { buildHomeViewModel } = require('./homeViewModel');
const {
  CalculationError,
  validateCalculationRequest,
  calculateRepayment,
} = require('../shared/repaymentCalculator');

const router = express.Router();

router.get('/privacy', (req, res) => {
  res.render('privacy', { legal });
});

router.get('/terms', (req, res) => {
  res.render('terms', { legal });
});

router.get('/impressum', (req, res) => {
  res.render('impressum', { legal });
});

router.get('/about', (req, res) => {
  res.render('about', { siteUrl: SITE_URL });
});

router.get('/methodology', (req, res) => {
  res.render('methodology', { siteUrl: SITE_URL });
});

router.get('/overseas-repayment-guides', (req, res) => {
  const featuredCountries = FEATURED_COUNTRY_SLUGS
    .map((slug) => COUNTRY_PAGES.find((page) => page.slug === slug))
    .filter(Boolean);

  res.render('guides', {
    siteUrl: SITE_URL,
    planPages: PLAN_PAGES,
    countryPages: COUNTRY_PAGES,
    featuredCountries,
    lastReviewed: '12 May 2026',
  });
});

router.get(getSeoPagePaths(), async (req, res) => {
  const slug = req.path.slice(1);
  const page = getSeoPage(slug);
  return res.render('seo-page', await buildSeoPageViewModel(page, getDefaultTaxYear()));
});

router.get('/csrf-token', (req, res) => {
  if (!res.locals.csrfToken) {
    return res.status(403).json({ error: 'Necessary cookies must be accepted before using the calculator.' });
  }
  return res.json({ csrfToken: res.locals.csrfToken });
});

// Serve home page
router.get('/', async (req, res) => {
  logger.info(`Handling GET request for '/'`);

  if (!hasPreferenceConsent(req)) {
    clearPreferenceCookies(res);
  }

  res.render('index', await buildHomeViewModel(req, getThresholdData));
});

// Handle POST calculate request
router.post('/calculate', verifyCsrfToken, async (req, res) => {
  const { targetCountry, selectedPlan, selectedYear } = req.body;
  const year = selectedYear;

  const profile = req.session?.userId ? db.getProfile(req.session.userId) : null;

  function sendError(status, message) {
    const countryForLog = typeof targetCountry === 'string' ? targetCountry : 'invalid';
    const planForLog = selectedPlan || 'none';
    const yearForLog = year || 'none';
    const userForLog = req.session?.userId || 'anonymous';
    logger.warn(`POST /calculate rejected: status=${status} reason="${message}" country=${countryForLog} plan=${planForLog} year=${yearForLog} includePg=${req.body.includePg === 'on'} noUndergradLoan=${req.body.noUndergradLoan === 'on'} userId=${userForLog}`);
    return res.status(status).json({ error: message });
  }

  try {
    const input = validateCalculationRequest(req.body);
    logger.info(`Handling POST /calculate: country=${targetCountry}, plan=${selectedPlan}, year=${year}, includePg=${input.includePg}, noUndergradLoan=${input.noUndergradLoan}`);

    const countryDataDict = input.noUndergradLoan
      ? await getThresholdData('planPg', year)
      : await getThresholdData(input.selectedUndergradPlan, year);
    const pgCountryDataDict = input.includePg && !input.noUndergradLoan
      ? await getThresholdData('planPg', year)
      : null;
    const result = calculateRepayment(input, {
      primaryCountryData: countryDataDict,
      pgCountryData: pgCountryDataDict,
      profile,
    });

    if (hasPreferenceConsent(req)) {
      if (input.selectedUndergradPlan) {
        res.cookie('selectedPlan', input.selectedUndergradPlan, COOKIE_OPTS);
      } else {
        res.clearCookie('selectedPlan', CLEAR_COOKIE_OPTS);
      }
      res.cookie('selectedCountry', input.targetCountry, COOKIE_OPTS);
      res.cookie('selectedYear', input.year, COOKIE_OPTS);
      res.cookie('includePg', String(input.includePg), COOKIE_OPTS);
      res.cookie('noUndergradLoan', String(input.noUndergradLoan), COOKIE_OPTS);
    }

    try {
      db.logCalculation(req.session.userId ?? null, {
        country: input.targetCountry,
        plan: input.noUndergradLoan ? 'planPg' : input.selectedUndergradPlan,
        taxYear: input.year,
        includePg: input.includePg,
      });
    } catch (logErr) {
      logger.warn(`Failed to log calculation: ${logErr.message}`);
    }

    return res.json(result);
  } catch (error) {
    if (error instanceof CalculationError) {
      return sendError(error.status, error.message);
    }
    logger.error(`POST /calculate error: ${error.message}`);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
