const express = require('express');
const logger = require('../utils/logger');
const { verifyCsrfToken } = require('../utils/csrf');
const {
  DEFAULT_YEAR, SUPPORTED_YEARS, computeCurrentTaxYear, getDefaultTaxYear,
  ALLOWED_PLANS, COOKIE_MAX_AGE, REPAYMENT_RATE, PGL_REPAYMENT_RATE, MONTHS_PER_YEAR,
  urlsByYear,
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
const { hasCookieConsent } = require('../utils/consent');
const { buildSeoPageViewModel } = require('../utils/seoGuideBuilder');
const legal = require('../config/legal');

const router = express.Router();

const COOKIE_OPTS = {
  maxAge: COOKIE_MAX_AGE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
};
const MAX_CALCULATION_SALARY = 1_000_000_000;

function hasPreferenceConsent(req) {
  return hasCookieConsent(req, 'preferences');
}

function preferenceCookie(req, name) {
  return hasPreferenceConsent(req) ? req.cookies[name] : undefined;
}

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

function getAvailablePlansForYear(year) {
  return ALLOWED_PLANS.filter((plan) => Boolean(urlsByYear[year]?.[plan]));
}

function isPlanAvailableForYear(plan, year) {
  return Boolean(urlsByYear[year]?.[plan]);
}

function buildAvailablePlansByYear() {
  return Object.fromEntries(
    SUPPORTED_YEARS.map((year) => [year, Object.keys(urlsByYear[year])])
  );
}

function resolveSelectedPlan(req, profile, year) {
  const availablePlans = getAvailablePlansForYear(year);
  const fallbackPlan = availablePlans[0];
  if (profile?.default_plan && availablePlans.includes(profile.default_plan)) return profile.default_plan;
  const cookiePlan = preferenceCookie(req, 'selectedPlan');
  return availablePlans.includes(cookiePlan) ? cookiePlan : fallbackPlan;
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
    const clearOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict' };
    res.clearCookie('selectedPlan', clearOpts);
    res.clearCookie('selectedCountry', clearOpts);
    res.clearCookie('selectedYear', clearOpts);
    res.clearCookie('includePg', clearOpts);
    res.clearCookie('noUndergradLoan', clearOpts);
  }

  const selectedYearCookie = preferenceCookie(req, 'selectedYear');
  const realCurrentTaxYear = computeCurrentTaxYear();
  const currentTaxYearSupported = SUPPORTED_YEARS.includes(realCurrentTaxYear);
  const defaultTaxYear = currentTaxYearSupported ? realCurrentTaxYear : DEFAULT_YEAR;
  const selectedYear = SUPPORTED_YEARS.includes(selectedYearCookie)
    ? selectedYearCookie
    : defaultTaxYear;
  const taxYearNotice = currentTaxYearSupported
    ? null
    : `The ${realCurrentTaxYear} overseas thresholds are not available yet. Showing latest available data: ${DEFAULT_YEAR}.`;

  try {
    const fullData = await getThresholdData('plan1', selectedYear);
    const countries = buildCountriesList(fullData);

    const profile = req.session.userId ? db.getProfile(req.session.userId) : null;

    const selectedPlan = resolveSelectedPlan(req, profile, selectedYear);
    const selectedCountry = profile?.default_country || preferenceCookie(req, 'selectedCountry') || '';
    const pglAvailable = isPlanAvailableForYear('planPg', selectedYear);
    const noUndergradLoan = pglAvailable && preferenceCookie(req, 'noUndergradLoan') === 'true';
    const includePg = pglAvailable && (noUndergradLoan || (profile ? !!profile.include_pg : preferenceCookie(req, 'includePg') === 'true'));

    res.render('index', {
      countries,
      selectedPlan,
      selectedCountry,
      selectedYear,
      includePg,
      noUndergradLoan,
      supportedYears: SUPPORTED_YEARS,
      realCurrentTaxYear,
      currentTaxYearSupported,
      taxYearNotice,
      availablePlans: getAvailablePlansForYear(selectedYear),
      pglAvailable,
      availablePlansByYear: buildAvailablePlansByYear(),
      planGuidePages: PLAN_PAGES,
      featuredCountryPages: FEATURED_COUNTRY_SLUGS
        .map((slug) => COUNTRY_PAGES.find((page) => page.slug === slug))
        .filter(Boolean),
      graduationDate: profile?.graduation_date || null,
      loanValueGbp: profile?.loan_value_gbp || null,
      loanValuePglGbp: profile?.loan_value_pgl_gbp || null,
      defaultSalary: profile?.default_salary || null,
    });
  } catch (error) {
    logger.error(`Error loading data: ${error.message}`);
    const selectedPlan = resolveSelectedPlan(req, null, selectedYear);
    const selectedCountry = preferenceCookie(req, 'selectedCountry') || '';
    const pglAvailable = isPlanAvailableForYear('planPg', selectedYear);
    const noUndergradLoan = pglAvailable && preferenceCookie(req, 'noUndergradLoan') === 'true';
    const includePg = pglAvailable && (noUndergradLoan || preferenceCookie(req, 'includePg') === 'true');
    res.render('index', {
      countries: [],
      selectedPlan,
      selectedCountry,
      selectedYear,
      includePg,
      noUndergradLoan,
      supportedYears: SUPPORTED_YEARS,
      realCurrentTaxYear,
      currentTaxYearSupported,
      taxYearNotice,
      availablePlans: getAvailablePlansForYear(selectedYear),
      pglAvailable,
      availablePlansByYear: buildAvailablePlansByYear(),
      planGuidePages: PLAN_PAGES,
      featuredCountryPages: FEATURED_COUNTRY_SLUGS
        .map((slug) => COUNTRY_PAGES.find((page) => page.slug === slug))
        .filter(Boolean),
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
        res.clearCookie('selectedPlan', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict' });
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
