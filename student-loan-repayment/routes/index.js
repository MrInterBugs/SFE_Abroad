const express = require('express');
const logger = require('../utils/logger');
const { verifyCsrfToken } = require('../utils/csrf');
const { DEFAULT_YEAR, SUPPORTED_YEARS, getCurrentTaxYear } = require('../config/constants');
const { fetchCountryData, getThresholdData } = require('../utils/fetchCountryData');
const currencySymbol = require('../utils/currencySymbol');

const router = express.Router();

const allowedPlans = ['plan1', 'plan2', 'plan4', 'plan5'];

// Serve home page
router.get('/', async (req, res) => {
  logger.info(`Handling GET request for '/'`);

  const selectedPlan = req.cookies.selectedPlan || 'plan1';
  const selectedCountry = req.cookies.selectedCountry || '';
  const selectedYear = SUPPORTED_YEARS.includes(req.cookies.selectedYear)
    ? req.cookies.selectedYear
    : getCurrentTaxYear();

  const plans = ['plan1', 'plan2', 'plan4', 'plan5'];

  try {
    // Fetch country lists for every year so the client can switch year without a reload.
    const countriesByYear = {};
    await Promise.all(
      SUPPORTED_YEARS.flatMap(year =>
        plans.map(async plan => {
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
    const empty = Object.fromEntries(SUPPORTED_YEARS.map(y => [y, Object.fromEntries(plans.map(p => [p, []]))]));
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
  const { targetCountry, salaryLocalCurrency, selectedPlan, selectedYear } = req.body;
  const year = SUPPORTED_YEARS.includes(selectedYear) ? selectedYear : DEFAULT_YEAR;

  logger.info(`Handling POST /calculate: country=${targetCountry}, plan=${selectedPlan}, year=${year}`);

  if (!allowedPlans.includes(selectedPlan)) {
    logger.info(`Invalid selectedPlan: ${selectedPlan}`);
    return res.status(400).render('result', { error: 'Invalid repayment plan selected.' });
  }

  res.cookie('selectedPlan', selectedPlan, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.cookie('selectedCountry', targetCountry, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.cookie('selectedYear', year, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' });

  try {
    const countryDataDict = await getThresholdData(selectedPlan, year);
    const countryData = countryDataDict[targetCountry];

    if (!countryData) {
      return res.render('result', { error: 'Country not found in the data.' });
    }

    const exchangeRate = parseFloat(countryData['Exchange rate']);
    let thresholdGbp;
    if (selectedPlan === 'plan1' || selectedPlan === 'plan4' || selectedPlan === 'plan5') {
      thresholdGbp = parseFloat(countryData['Earnings threshold (GBP)'].replace('£', '').replace(',', ''));
    } else if (selectedPlan === 'plan2') {
      thresholdGbp = parseFloat(countryData['Lower earnings threshold (GBP)'].replace('£', '').replace(',', ''));
    }

    const salaryGbp = salaryLocalCurrency * exchangeRate;
    const amountOverThreshold = salaryGbp - thresholdGbp;

    let monthlyRepayment = 0;
    if (amountOverThreshold > 0) {
      monthlyRepayment = (amountOverThreshold * 0.09) / 12;
    }

    res.render('result', {
      error: null,
      monthlyRepayment: monthlyRepayment.toFixed(2),
      targetCountry,
      salaryLocalCurrency: parseFloat(salaryLocalCurrency).toFixed(2),
      salaryCurrencySymbol: currencySymbol(countryData['Currency']),
      exchangeRate: exchangeRate.toFixed(2),
      thresholdGbp: thresholdGbp.toFixed(2),
      selectedPlan,
      selectedYear: year,
    });
  } catch (error) {
    res.render('result', { error: `Error: ${error.message}` });
  }
});

module.exports = router;
