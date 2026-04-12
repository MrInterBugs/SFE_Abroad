const express = require('express');
const logger = require('../utils/logger');
const { verifyCsrfToken } = require('../utils/csrf');
const {
  DEFAULT_YEAR, SUPPORTED_YEARS, getCurrentTaxYear,
  ALLOWED_PLANS, COOKIE_MAX_AGE, REPAYMENT_RATE, MONTHS_PER_YEAR,
} = require('../config/constants');
const { fetchCountryData, getThresholdData } = require('../utils/fetchCountryData');
const currencySymbol = require('../utils/currencySymbol');

const router = express.Router();

const COOKIE_OPTS = (req) => ({
  maxAge: COOKIE_MAX_AGE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
});

// Serve home page
router.get('/', async (req, res) => {
  logger.info(`Handling GET request for '/'`);

  const selectedPlan = ALLOWED_PLANS.includes(req.cookies.selectedPlan)
    ? req.cookies.selectedPlan
    : 'plan1';
  const selectedCountry = req.cookies.selectedCountry || '';
  const selectedYear = SUPPORTED_YEARS.includes(req.cookies.selectedYear)
    ? req.cookies.selectedYear
    : getCurrentTaxYear();

  try {
    // Fetch country lists for every year so the client can switch year without a reload.
    const countriesByYear = {};
    await Promise.all(
      SUPPORTED_YEARS.flatMap(year =>
        ALLOWED_PLANS.map(async plan => {
          const list = await fetchCountryData(plan, year);
          if (!countriesByYear[year]) countriesByYear[year] = {};
          countriesByYear[year][plan] = list;
        })
      )
    );

    res.render('index', {
      countriesByYear,
      selectedPlan,
      selectedCountry,
      selectedYear,
      supportedYears: SUPPORTED_YEARS,
    });
  } catch (error) {
    logger.error(`Error loading data: ${error.message}`);
    const empty = Object.fromEntries(
      SUPPORTED_YEARS.map(y => [y, Object.fromEntries(ALLOWED_PLANS.map(p => [p, []]))])
    );
    res.render('index', {
      countriesByYear: empty,
      selectedPlan,
      selectedCountry,
      selectedYear,
      supportedYears: SUPPORTED_YEARS,
      error: error.message,
    });
  }
});

// Handle POST calculate request
router.post('/calculate', verifyCsrfToken, async (req, res) => {
  const { targetCountry, selectedPlan, selectedYear } = req.body;
  const year = SUPPORTED_YEARS.includes(selectedYear) ? selectedYear : DEFAULT_YEAR;

  logger.info(`Handling POST /calculate: country=${targetCountry}, plan=${selectedPlan}, year=${year}`);

  if (!ALLOWED_PLANS.includes(selectedPlan)) {
    return res.status(400).render('result', { error: 'Invalid repayment plan selected.' });
  }

  // Validate salary: must be a finite positive number
  const salary = parseFloat(req.body.salaryLocalCurrency);
  if (!isFinite(salary) || salary <= 0) {
    return res.status(400).render('result', { error: 'Please enter a valid positive salary.' });
  }

  res.cookie('selectedPlan', selectedPlan, COOKIE_OPTS(req));
  res.cookie('selectedCountry', targetCountry, COOKIE_OPTS(req));
  res.cookie('selectedYear', year, COOKIE_OPTS(req));

  try {
    const countryDataDict = await getThresholdData(selectedPlan, year);
    const countryData = countryDataDict[targetCountry];

    if (!countryData) {
      return res.render('result', { error: 'Country not found in the data.' });
    }

    const exchangeRate = parseFloat(countryData['Exchange rate']);
    const thresholdField = (selectedPlan === 'plan2')
      ? 'Lower earnings threshold (GBP)'
      : 'Earnings threshold (GBP)';
    const thresholdRaw = countryData[thresholdField];

    if (!isFinite(exchangeRate) || !thresholdRaw) {
      return res.render('result', { error: 'Unexpected data format for this country. Please try again later.' });
    }

    const thresholdGbp = parseFloat(thresholdRaw.replace(/[£,]/g, ''));
    const salaryGbp = salary * exchangeRate;
    const amountOverThreshold = salaryGbp - thresholdGbp;

    const monthlyRepayment = amountOverThreshold > 0
      ? (amountOverThreshold * REPAYMENT_RATE) / MONTHS_PER_YEAR
      : 0;

    res.render('result', {
      error: null,
      monthlyRepayment: monthlyRepayment.toFixed(2),
      targetCountry,
      salaryLocalCurrency: salary.toFixed(2),
      salaryCurrencySymbol: currencySymbol(countryData['Currency']),
      exchangeRate: exchangeRate.toFixed(2),
      thresholdGbp: thresholdGbp.toFixed(2),
      selectedPlan,
      selectedYear: year,
    });
  } catch (error) {
    logger.error(`POST /calculate error: ${error.message}`);
    res.render('result', { error: `Something went wrong. Please try again.` });
  }
});

module.exports = router;
