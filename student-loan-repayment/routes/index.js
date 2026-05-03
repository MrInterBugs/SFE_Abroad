const express = require('express');
const logger = require('../utils/logger');
const { verifyCsrfToken } = require('../utils/csrf');
const {
  DEFAULT_YEAR, SUPPORTED_YEARS, getCurrentTaxYear,
  ALLOWED_PLANS, COOKIE_MAX_AGE, REPAYMENT_RATE, PGL_REPAYMENT_RATE, MONTHS_PER_YEAR,
} = require('../config/constants');
const { getThresholdData } = require('../utils/fetchCountryData');
const { getProfile } = require('../utils/db');
const currencySymbol = require('../utils/currencySymbol');

const router = express.Router();

const COOKIE_OPTS = (req) => ({
  maxAge: COOKIE_MAX_AGE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
});

function hasPreferenceConsent(req) {
  const raw = req.cookies.CookieConsent;
  if (!raw) return false;
  return decodeURIComponent(raw).includes('preferences:true');
}

function buildCountriesList(fullData) {
  return Object.entries(fullData).map(([name, data]) => {
    const rawCurrency = (data['Currency'] || '').replace(/[\s ]+/g, ' ').trim();
    return {
      name,
      currency: currencySymbol.NAME_TO_ISO[rawCurrency] || '',
      symbol: currencySymbol(data['Currency'] || ''),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

router.get('/privacy', (req, res) => {
  res.render('privacy');
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
    const clearOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict' };
    res.clearCookie('selectedPlan', clearOpts);
    res.clearCookie('selectedCountry', clearOpts);
    res.clearCookie('selectedYear', clearOpts);
    res.clearCookie('includePg', clearOpts);
  }

  const selectedYear = SUPPORTED_YEARS.includes(req.cookies.selectedYear)
    ? req.cookies.selectedYear
    : getCurrentTaxYear();

  try {
    const fullData = await getThresholdData('plan1', getCurrentTaxYear());
    const countries = buildCountriesList(fullData);

    const profile = req.session.userId ? getProfile(req.session.userId) : null;

    const selectedPlan = (profile?.default_plan && ALLOWED_PLANS.includes(profile.default_plan))
      ? profile.default_plan
      : (ALLOWED_PLANS.includes(req.cookies.selectedPlan) ? req.cookies.selectedPlan : 'plan1');
    const selectedCountry = profile?.default_country || req.cookies.selectedCountry || '';
    const includePg = profile ? !!profile.include_pg : req.cookies.includePg === 'true';

    res.render('index', {
      countries,
      selectedPlan,
      selectedCountry,
      selectedYear,
      includePg,
      supportedYears: SUPPORTED_YEARS,
      graduationDate: profile?.graduation_date || null,
      loanValueGbp: profile?.loan_value_gbp || null,
      loanValuePglGbp: profile?.loan_value_pgl_gbp || null,
      defaultSalary: profile?.default_salary || null,
    });
  } catch (error) {
    logger.error(`Error loading data: ${error.message}`);
    const selectedPlan = ALLOWED_PLANS.includes(req.cookies.selectedPlan) ? req.cookies.selectedPlan : 'plan1';
    const selectedCountry = req.cookies.selectedCountry || '';
    const includePg = req.cookies.includePg === 'true';
    res.render('index', {
      countries: [],
      selectedPlan,
      selectedCountry,
      selectedYear,
      includePg,
      supportedYears: SUPPORTED_YEARS,
      graduationDate: null,
      loanValueGbp: null,
      loanValuePglGbp: null,
      defaultSalary: null,
    });
  }
});

// Handle POST calculate request
router.post('/calculate', verifyCsrfToken, async (req, res) => {
  const { targetCountry, selectedPlan, selectedYear } = req.body;
  const includePg = req.body.includePg === 'on';
  const year = SUPPORTED_YEARS.includes(selectedYear) ? selectedYear : DEFAULT_YEAR;
  const isJson = req.headers['accept'] && req.headers['accept'].includes('application/json');

  const profile = req.session?.userId ? getProfile(req.session.userId) : null;
  const loanValueGbp = profile?.loan_value_gbp || null;
  const loanValuePglGbp = profile?.loan_value_pgl_gbp || null;

  logger.info(`Handling POST /calculate: country=${targetCountry}, plan=${selectedPlan}, year=${year}, includePg=${includePg}`);

  function sendError(status, message) {
    if (isJson) return res.status(status).json({ error: message });
    return res.status(status).render('result', { error: message });
  }

  if (!ALLOWED_PLANS.includes(selectedPlan)) {
    return sendError(400, 'Invalid repayment plan selected.');
  }

  // Validate salary: must be a finite positive number
  const salary = parseFloat(req.body.salaryLocalCurrency);
  if (!isFinite(salary) || salary <= 0) {
    return sendError(400, 'Please enter a valid positive salary.');
  }

  if (hasPreferenceConsent(req)) {
    res.cookie('selectedPlan', selectedPlan, COOKIE_OPTS(req));
    res.cookie('selectedCountry', targetCountry, COOKIE_OPTS(req));
    res.cookie('selectedYear', year, COOKIE_OPTS(req));
    res.cookie('includePg', String(includePg), COOKIE_OPTS(req));
  }

  try {
    const countryDataDict = await getThresholdData(selectedPlan, year);
    const countryData = countryDataDict[targetCountry];

    if (!countryData) {
      return sendError(200, 'Country not found in the data.');
    }

    const exchangeRate = parseFloat(countryData['Exchange rate']);
    const thresholdField = (selectedPlan === 'plan2')
      ? 'Lower earnings threshold (GBP)'
      : 'Earnings threshold (GBP)';
    const thresholdRaw = countryData[thresholdField];

    if (!isFinite(exchangeRate) || !thresholdRaw) {
      return sendError(200, 'Unexpected data format for this country. Please try again later.');
    }

    const thresholdGbp = parseFloat(thresholdRaw.replace(/[£,]/g, ''));
    const salaryGbp = salary * exchangeRate;
    const amountOverThreshold = salaryGbp - thresholdGbp;

    const monthlyRepayment = amountOverThreshold > 0
      ? (amountOverThreshold * REPAYMENT_RATE) / MONTHS_PER_YEAR
      : 0;

    // Postgraduate loan calculation (optional)
    let pglMonthlyRepayment = null;
    let pglThresholdGbp = null;
    if (includePg) {
      const pgDataDict = await getThresholdData('planPg', year);
      const pgCountryData = pgDataDict[targetCountry];
      if (pgCountryData) {
        const pgThresholdRaw = pgCountryData['Earnings threshold (GBP)'];
        if (pgThresholdRaw) {
          pglThresholdGbp = parseFloat(pgThresholdRaw.replace(/[£,]/g, ''));
          const pgAmountOver = salaryGbp - pglThresholdGbp;
          pglMonthlyRepayment = pgAmountOver > 0
            ? (pgAmountOver * PGL_REPAYMENT_RATE) / MONTHS_PER_YEAR
            : 0;
        }
      }
    }

    const salaryCurrencySymbol = currencySymbol(countryData['Currency']);

    if (isJson) {
      return res.json({
        monthlyRepayment: monthlyRepayment.toFixed(2),
        pglMonthlyRepayment: pglMonthlyRepayment !== null ? pglMonthlyRepayment.toFixed(2) : null,
        pglThresholdGbp: pglThresholdGbp !== null ? pglThresholdGbp.toFixed(2) : null,
        thresholdGbp: thresholdGbp.toFixed(2),
        localPerGbp: (1 / exchangeRate).toFixed(4),
        salaryGbp: salaryGbp.toFixed(2),
        selectedPlan,
        selectedYear: year,
        salaryCurrencySymbol,
        loanValueGbp,
        loanValuePglGbp,
      });
    }

    res.render('result', {
      error: null,
      monthlyRepayment: monthlyRepayment.toFixed(2),
      pglMonthlyRepayment: pglMonthlyRepayment !== null ? pglMonthlyRepayment.toFixed(2) : null,
      pglThresholdGbp: pglThresholdGbp !== null ? pglThresholdGbp.toFixed(2) : null,
      targetCountry,
      salaryLocalCurrency: salary.toFixed(2),
      salaryCurrencySymbol,
      exchangeRate: exchangeRate.toFixed(2),
      thresholdGbp: thresholdGbp.toFixed(2),
      selectedPlan,
      selectedYear: year,
      loanValueGbp,
      loanValuePglGbp,
      graduationDate: profile?.graduation_date || null,
    });
  } catch (error) {
    logger.error(`POST /calculate error: ${error.message}`);
    if (isJson) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    res.render('result', { error: `Something went wrong. Please try again.` });
  }
});

module.exports = router;
