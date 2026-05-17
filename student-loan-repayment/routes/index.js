const express = require('express');
const logger = require('../utils/logger');
const { verifyCsrfToken } = require('../utils/csrf');
const {
  SUPPORTED_YEARS, getDefaultTaxYear,
  ALLOWED_PLANS, REPAYMENT_RATE, PGL_REPAYMENT_RATE, MONTHS_PER_YEAR,
} = require('../config/constants');
const { getThresholdData } = require('../utils/fetchCountryData');
const db = require('../utils/db');
const currencySymbol = require('../utils/currencySymbol');
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
const {
  isPlanAvailableForYear,
  buildHomeViewModel,
} = require('./homeViewModel');

const router = express.Router();

const MAX_CALCULATION_SALARY = 1_000_000_000;

function parseRequiredNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  return Number(raw);
}

function parseGbpAmount(value) {
  if (typeof value !== 'string') return NaN;
  return parseFloat(value.replace(/[£,]/g, ''));
}

function repaymentRateForPlan(plan) {
  return plan === 'planPg' ? PGL_REPAYMENT_RATE : REPAYMENT_RATE;
}

function floorRepaymentPounds(value) {
  return Math.floor(Math.max(0, value));
}

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
  const loanValueGbp = profile?.loan_value_gbp || null;
  const loanValuePglGbp = profile?.loan_value_pgl_gbp || null;

  function sendError(status, message) {
    const countryForLog = typeof targetCountry === 'string' ? targetCountry : 'invalid';
    const planForLog = selectedPlan || 'none';
    const yearForLog = year || 'none';
    const userForLog = req.session?.userId || 'anonymous';
    logger.warn(`POST /calculate rejected: status=${status} reason="${message}" country=${countryForLog} plan=${planForLog} year=${yearForLog} includePg=${req.body.includePg === 'on'} noUndergradLoan=${req.body.noUndergradLoan === 'on'} userId=${userForLog}`);
    return res.status(status).json({ error: message });
  }

  if (typeof targetCountry !== 'string' || !targetCountry.trim()) {
    return sendError(400, 'Please select a valid country.');
  }

  if (req.body.includePg !== undefined && req.body.includePg !== 'on') {
    return sendError(400, 'Invalid Postgraduate Loan selection.');
  }
  if (req.body.noUndergradLoan !== undefined && req.body.noUndergradLoan !== 'on') {
    return sendError(400, 'Invalid undergraduate loan selection.');
  }
  const includePg = req.body.includePg === 'on';
  const noUndergradLoan = req.body.noUndergradLoan === 'on';
  logger.info(`Handling POST /calculate: country=${targetCountry}, plan=${selectedPlan}, year=${year}, includePg=${includePg}, noUndergradLoan=${noUndergradLoan}`);

  if (!SUPPORTED_YEARS.includes(year)) {
    return sendError(400, 'Invalid tax year selected.');
  }

  if (!noUndergradLoan && !ALLOWED_PLANS.includes(selectedPlan)) {
    return sendError(400, 'Invalid repayment plan selected.');
  }

  if (!noUndergradLoan && !isPlanAvailableForYear(selectedPlan, year)) {
    return sendError(400, 'Selected repayment plan is not available for this tax year.');
  }

  if (includePg && !isPlanAvailableForYear('planPg', year)) {
    return sendError(400, 'Postgraduate Loan data is not available for this tax year.');
  }

  if (noUndergradLoan && !includePg) {
    return sendError(400, 'Select Postgraduate Loan to calculate without an undergraduate loan.');
  }

  // Validate salary: must be a finite positive number
  const salary = parseRequiredNumber(req.body.salaryLocalCurrency);
  if (!Number.isFinite(salary) || salary <= 0 || salary > MAX_CALCULATION_SALARY) {
    return sendError(400, 'Please enter a valid positive salary.');
  }

  try {
    const selectedUndergradPlan = noUndergradLoan ? null : selectedPlan;
    const countryDataDict = noUndergradLoan
      ? await getThresholdData('planPg', year)
      : await getThresholdData(selectedUndergradPlan, year);
    const countryData = countryDataDict[targetCountry];

    if (!countryData) {
      return sendError(400, 'Country not found in the data.');
    }

    const exchangeRate = parseFloat(countryData['Exchange rate']);
    const effectivePlan = noUndergradLoan ? 'planPg' : selectedUndergradPlan;
    const thresholdField = selectedUndergradPlan === 'plan2'
      ? 'Lower earnings threshold (GBP)'
      : 'Earnings threshold (GBP)';
    const thresholdRaw = countryData[thresholdField];

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || !thresholdRaw) {
      return sendError(502, 'Unexpected data format for this country. Please try again later.');
    }

    const thresholdGbp = parseGbpAmount(thresholdRaw);
    if (!Number.isFinite(thresholdGbp)) {
      return sendError(502, 'Unexpected data format for this country. Please try again later.');
    }

    const plan2LowerThresholdGbp = selectedUndergradPlan === 'plan2'
      ? thresholdGbp
      : null;
    const plan2UpperThresholdRaw = selectedUndergradPlan === 'plan2'
      ? countryData['Upper earnings threshold (GBP)']
      : null;
    const plan2UpperThresholdGbp = plan2UpperThresholdRaw
      ? parseGbpAmount(plan2UpperThresholdRaw)
      : null;
    if (selectedUndergradPlan === 'plan2' && !Number.isFinite(plan2UpperThresholdGbp)) {
      return sendError(502, 'Unexpected data format for this country. Please try again later.');
    }

    const salaryGbp = salary * exchangeRate;
    if (!Number.isFinite(salaryGbp)) {
      return sendError(400, 'Please enter a valid positive salary.');
    }
    const amountOverThreshold = salaryGbp - thresholdGbp;

    if (hasPreferenceConsent(req)) {
      if (selectedUndergradPlan) {
        res.cookie('selectedPlan', selectedUndergradPlan, COOKIE_OPTS);
      } else {
        res.clearCookie('selectedPlan', CLEAR_COOKIE_OPTS);
      }
      res.cookie('selectedCountry', targetCountry, COOKIE_OPTS);
      res.cookie('selectedYear', year, COOKIE_OPTS);
      res.cookie('includePg', String(includePg), COOKIE_OPTS);
      res.cookie('noUndergradLoan', String(noUndergradLoan), COOKIE_OPTS);
    }

    const primaryRepaymentRate = repaymentRateForPlan(effectivePlan);
    const monthlyRepayment = !noUndergradLoan && amountOverThreshold > 0
      ? floorRepaymentPounds((amountOverThreshold * primaryRepaymentRate) / MONTHS_PER_YEAR)
      : 0;

    // Postgraduate loan calculation (optional)
    let pglMonthlyRepayment = null;
    let pglThresholdGbp = null;
    if (includePg) {
      const pgCountryData = noUndergradLoan
        ? countryData
        : (await getThresholdData('planPg', year))[targetCountry];
      const pgThresholdRaw = pgCountryData?.['Earnings threshold (GBP)'];
      if (!pgCountryData || !pgThresholdRaw) {
        return sendError(502, 'Unexpected postgraduate loan data format for this country. Please try again later.');
      }

      pglThresholdGbp = parseGbpAmount(pgThresholdRaw);
      if (!Number.isFinite(pglThresholdGbp)) {
        return sendError(502, 'Unexpected postgraduate loan data format for this country. Please try again later.');
      }

      const pgAmountOver = salaryGbp - pglThresholdGbp;
      pglMonthlyRepayment = pgAmountOver > 0
        ? floorRepaymentPounds((pgAmountOver * PGL_REPAYMENT_RATE) / MONTHS_PER_YEAR)
        : 0;
    }

    const salaryCurrencySymbol = currencySymbol(countryData['Currency']);

    try {
      db.logCalculation(req.session.userId ?? null, {
        country: targetCountry,
        plan: noUndergradLoan ? 'planPg' : selectedPlan,
        taxYear: year,
        salaryLocal: salary,
        salaryGbp,
        exchangeRate,
        thresholdGbp,
        monthlyRepayment,
        includePg,
        pglMonthlyRepayment,
        pglThresholdGbp,
      });
    } catch (logErr) {
      logger.warn(`Failed to log calculation: ${logErr.message}`);
    }

    return res.json({
      monthlyRepayment: monthlyRepayment.toFixed(2),
      pglMonthlyRepayment: pglMonthlyRepayment !== null ? pglMonthlyRepayment.toFixed(2) : null,
      pglThresholdGbp: pglThresholdGbp !== null ? pglThresholdGbp.toFixed(2) : null,
      thresholdGbp: thresholdGbp.toFixed(2),
      plan2LowerThresholdGbp: plan2LowerThresholdGbp !== null ? plan2LowerThresholdGbp.toFixed(2) : null,
      plan2UpperThresholdGbp: plan2UpperThresholdGbp !== null ? plan2UpperThresholdGbp.toFixed(2) : null,
      localPerGbp: (1 / exchangeRate).toFixed(4),
      salaryGbp: salaryGbp.toFixed(2),
      selectedPlan: selectedUndergradPlan,
      effectivePlan,
      noUndergradLoan,
      selectedYear: year,
      salaryCurrencySymbol,
      loanValueGbp,
      loanValuePglGbp,
    });
  } catch (error) {
    logger.error(`POST /calculate error: ${error.message}`);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
