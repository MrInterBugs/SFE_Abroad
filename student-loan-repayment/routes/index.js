const express = require('express');
const logger = require('../utils/logger');
const { verifyCsrfToken } = require('../utils/csrf');
const {
  DEFAULT_YEAR, SUPPORTED_YEARS, getCurrentTaxYear,
  ALLOWED_PLANS, COOKIE_MAX_AGE, REPAYMENT_RATE, PGL_REPAYMENT_RATE, MONTHS_PER_YEAR,
  urlsByYear,
} = require('../config/constants');
const { getThresholdData } = require('../utils/fetchCountryData');
const { getProfile } = require('../utils/db');
const db = require('../utils/db');
const currencySymbol = require('../utils/currencySymbol');
const { SITE_URL, getSeoPage, getSeoPagePaths } = require('../config/seoPages');
const { hasCookieConsent } = require('../utils/consent');

const router = express.Router();

const COOKIE_OPTS = (req) => ({
  maxAge: COOKIE_MAX_AGE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
});

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

const SEO_THRESHOLD_PLANS = [
  { key: 'plan1', label: 'Plan 1', field: 'Earnings threshold (GBP)' },
  { key: 'plan2', label: 'Plan 2', field: 'Lower earnings threshold (GBP)' },
  { key: 'plan4', label: 'Plan 4', field: 'Earnings threshold (GBP)' },
  { key: 'plan5', label: 'Plan 5', field: 'Earnings threshold (GBP)' },
  { key: 'planPg', label: 'Postgraduate Loan', field: 'Earnings threshold (GBP)' },
];

async function buildCountryThresholdExamples(country, year) {
  const rows = await Promise.all(SEO_THRESHOLD_PLANS.map(async (plan) => {
    try {
      const data = await getThresholdData(plan.key, year);
      const countryData = data[country];
      if (!countryData || !countryData[plan.field]) return null;
      return {
        plan: plan.label,
        threshold: countryData[plan.field],
        exchangeRate: countryData['Exchange rate'] || 'n/a',
      };
    } catch (err) {
      logger.warn(`SEO threshold example failed: ${plan.key} ${country} ${year} — ${err.message}`);
      return null;
    }
  }));
  return rows.filter(Boolean);
}

function buildSeoPageSchema(page) {
  const pageUrl = `${SITE_URL}/${page.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Calculator', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: page.title, item: pageUrl },
        ],
      },
      {
        '@type': 'Article',
        headline: page.title,
        description: page.description,
        mainEntityOfPage: pageUrl,
        publisher: {
          '@type': 'Person',
          name: 'Aedan L',
        },
      },
    ],
  };
}

function serializeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

router.get('/privacy', (req, res) => {
  res.render('privacy');
});

router.get('/about', (req, res) => {
  res.render('about', { siteUrl: SITE_URL });
});

router.get('/methodology', (req, res) => {
  res.render('methodology', { siteUrl: SITE_URL });
});

router.get(getSeoPagePaths(), async (req, res) => {
  const slug = req.path.slice(1);
  const page = getSeoPage(slug);
  const taxYear = getCurrentTaxYear();
  const thresholds = page.kind === 'country'
    ? await buildCountryThresholdExamples(page.country, taxYear)
    : [];

  return res.render('seo-page', {
    page,
    siteUrl: SITE_URL,
    taxYear,
    thresholds,
    schemaJson: serializeJsonForHtml(buildSeoPageSchema(page)),
  });
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

  const selectedYearCookie = preferenceCookie(req, 'selectedYear');
  const selectedYear = SUPPORTED_YEARS.includes(selectedYearCookie)
    ? selectedYearCookie
    : getCurrentTaxYear();

  try {
    const fullData = await getThresholdData('plan1', getCurrentTaxYear());
    const countries = buildCountriesList(fullData);

    const profile = req.session.userId ? getProfile(req.session.userId) : null;

    const selectedPlan = resolveSelectedPlan(req, profile, selectedYear);
    const selectedCountry = profile?.default_country || preferenceCookie(req, 'selectedCountry') || '';
    const pglAvailable = isPlanAvailableForYear('planPg', selectedYear);
    const includePg = pglAvailable && (profile ? !!profile.include_pg : preferenceCookie(req, 'includePg') === 'true');

    res.render('index', {
      countries,
      selectedPlan,
      selectedCountry,
      selectedYear,
      includePg,
      supportedYears: SUPPORTED_YEARS,
      availablePlans: getAvailablePlansForYear(selectedYear),
      pglAvailable,
      availablePlansByYear: buildAvailablePlansByYear(),
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
    const includePg = pglAvailable && preferenceCookie(req, 'includePg') === 'true';
    res.render('index', {
      countries: [],
      selectedPlan,
      selectedCountry,
      selectedYear,
      includePg,
      supportedYears: SUPPORTED_YEARS,
      availablePlans: getAvailablePlansForYear(selectedYear),
      pglAvailable,
      availablePlansByYear: buildAvailablePlansByYear(),
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

  if (!isPlanAvailableForYear(selectedPlan, year)) {
    return sendError(400, 'Selected repayment plan is not available for this tax year.');
  }

  if (includePg && !isPlanAvailableForYear('planPg', year)) {
    return sendError(400, 'Postgraduate Loan data is not available for this tax year.');
  }

  // Validate salary: must be a finite positive number
  const salary = parseRequiredNumber(req.body.salaryLocalCurrency);
  if (!Number.isFinite(salary) || salary <= 0) {
    return sendError(400, 'Please enter a valid positive salary.');
  }

  try {
    const countryDataDict = await getThresholdData(selectedPlan, year);
    const countryData = countryDataDict[targetCountry];

    if (!countryData) {
      return sendError(400, 'Country not found in the data.');
    }

    const exchangeRate = parseFloat(countryData['Exchange rate']);
    const thresholdField = (selectedPlan === 'plan2')
      ? 'Lower earnings threshold (GBP)'
      : 'Earnings threshold (GBP)';
    const thresholdRaw = countryData[thresholdField];

    if (!isFinite(exchangeRate) || !thresholdRaw) {
      return sendError(502, 'Unexpected data format for this country. Please try again later.');
    }

    const thresholdGbp = parseFloat(thresholdRaw.replace(/[£,]/g, ''));
    const salaryGbp = salary * exchangeRate;
    const amountOverThreshold = salaryGbp - thresholdGbp;

    if (hasPreferenceConsent(req)) {
      res.cookie('selectedPlan', selectedPlan, COOKIE_OPTS(req));
      res.cookie('selectedCountry', targetCountry, COOKIE_OPTS(req));
      res.cookie('selectedYear', year, COOKIE_OPTS(req));
      res.cookie('includePg', String(includePg), COOKIE_OPTS(req));
    }

    const monthlyRepayment = amountOverThreshold > 0
      ? (amountOverThreshold * REPAYMENT_RATE) / MONTHS_PER_YEAR
      : 0;

    // Postgraduate loan calculation (optional)
    let pglMonthlyRepayment = null;
    let pglThresholdGbp = null;
    if (includePg) {
      const pgDataDict = await getThresholdData('planPg', year);
      const pgCountryData = pgDataDict[targetCountry];
      const pgThresholdRaw = pgCountryData?.['Earnings threshold (GBP)'];
      if (!pgCountryData || !pgThresholdRaw) {
        return sendError(502, 'Unexpected postgraduate loan data format for this country. Please try again later.');
      }

      pglThresholdGbp = parseFloat(pgThresholdRaw.replace(/[£,]/g, ''));
      if (!Number.isFinite(pglThresholdGbp)) {
        return sendError(502, 'Unexpected postgraduate loan data format for this country. Please try again later.');
      }

      const pgAmountOver = salaryGbp - pglThresholdGbp;
      pglMonthlyRepayment = pgAmountOver > 0
        ? (pgAmountOver * PGL_REPAYMENT_RATE) / MONTHS_PER_YEAR
        : 0;
    }

    const salaryCurrencySymbol = currencySymbol(countryData['Currency']);

    try {
      db.logCalculation(req.session.userId ?? null, {
        country: targetCountry,
        plan: selectedPlan,
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
      salaryGbp: salaryGbp.toFixed(2),
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
