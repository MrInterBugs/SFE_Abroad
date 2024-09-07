const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { urls } = require('../config/constants');
const fetchCountryData = require('../utils/fetchCountryData');

const router = express.Router();

// Define allowed plans to prevent SSRF
const allowedPlans = ['plan1', 'plan2', 'plan4'];

// Serve home page
router.get('/', async (req, res) => {
  logger.info(`Handling GET request for '/'`);
  try {
    const [countriesPlan1, countriesPlan2, countriesPlan4] = await Promise.all([
      fetchCountryData('plan1'),
      fetchCountryData('plan2'),
      fetchCountryData('plan4'),
    ]);

    const selectedPlan = req.cookies.selectedPlan || 'plan1';
    const selectedCountry = req.cookies.selectedCountry || '';

    res.render('index', {
      countriesPlan1,
      countriesPlan2,
      countriesPlan4,
      selectedPlan,
      selectedCountry
    });
  } catch (error) {
    logger.error(`Error loading data: ${error.message}`);
    res.render('index', {
      countriesPlan1: [],
      countriesPlan2: [],
      countriesPlan4: [],
      selectedPlan: 'plan1',
      selectedCountry: '',
      error: error.message
    });
  }
});

// Handle POST calculate request
router.post('/calculate', async (req, res) => {
  const { targetCountry, salaryLocalCurrency, selectedPlan } = req.body;
  logger.info(`Handling POST request for '/calculate' with targetCountry: ${targetCountry}, salaryLocalCurrency: ${salaryLocalCurrency}, and selectedPlan: ${selectedPlan}`);

  if (!allowedPlans.includes(selectedPlan)) {
    logger.info(`Invalid selectedPlan: ${selectedPlan}`);
    return res.status(400).render('result', { error: 'Invalid repayment plan selected.' });
  }

  res.cookie('selectedPlan', selectedPlan, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.cookie('selectedCountry', targetCountry, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' });

  try {
    const response = await axios.get(urls[selectedPlan]);
    if (response.status === 200) {
      const html = response.data;
      const $ = cheerio.load(html);
      const countryDataDict = {};
      const headers = [];

      $('table th').each((i, element) => {
        headers.push($(element).text().trim());
      });

      $('table tr').each((i, element) => {
        if (i === 0) return;

        const columns = $(element).find('td');
        const countryName = $(columns[0]).text().trim();

        const data = {};
        for (let j = 1; j < headers.length; j++) {
          data[headers[j]] = $(columns[j]).text().trim();
        }
        countryDataDict[countryName] = data;
      });

      const countryData = countryDataDict[targetCountry];
      if (countryData) {
        const exchangeRate = parseFloat(countryData['Exchange rate']);
        let thresholdGbp;
        if (selectedPlan === 'plan1' || selectedPlan === 'plan4') {
          thresholdGbp = parseFloat(countryData['Earnings threshold (GBP)'].replace('£', '').replace(',', ''));
        } else if (selectedPlan === 'plan2') {
          thresholdGbp = parseFloat(countryData['Lower earnings threshold (GBP)'].replace('£', '').replace(',', ''));
        }

        const salaryGbp = salaryLocalCurrency * exchangeRate;
        const amountOverThreshold = salaryGbp - thresholdGbp;

        let monthlyRepayment = 0;
        if (amountOverThreshold > 0) {
          const annualRepayment = amountOverThreshold * 0.09;
          monthlyRepayment = annualRepayment / 12;
        }

        res.render('result', {
          error: null,
          monthlyRepayment: monthlyRepayment.toFixed(2),
          targetCountry,
          salaryLocalCurrency,
          exchangeRate: exchangeRate.toFixed(2),
          thresholdGbp: thresholdGbp.toFixed(2),
          selectedPlan
        });
      } else {
        res.render('result', { error: "Country not found in the data." });
      }
    } else {
      res.render('result', { error: `Failed to retrieve the webpage for Plan ${selectedPlan}. Status code: ${response.status}` });
    }
  } catch (error) {
    res.render('result', { error: `Error: ${error.message}` });
  }
});

module.exports = router;
