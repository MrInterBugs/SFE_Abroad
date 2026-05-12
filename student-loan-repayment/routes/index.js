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

const router = express.Router();

const COOKIE_OPTS = {
  maxAge: COOKIE_MAX_AGE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
};

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

function parseExchangeRate(value) {
  return parseFloat(String(value ?? '').replace(/,/g, ''));
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatGbp(value) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatLocalAmount(value, currencyCode) {
  if (!currencyCode) return formatNumber(value);
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
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
  { key: 'plan1', label: 'Plan 1', field: 'Earnings threshold (GBP)', rate: REPAYMENT_RATE },
  { key: 'plan2', label: 'Plan 2', field: 'Lower earnings threshold (GBP)', rate: REPAYMENT_RATE },
  { key: 'plan4', label: 'Plan 4', field: 'Earnings threshold (GBP)', rate: REPAYMENT_RATE },
  { key: 'plan5', label: 'Plan 5', field: 'Earnings threshold (GBP)', rate: REPAYMENT_RATE },
  { key: 'planPg', label: 'Postgraduate Loan', field: 'Earnings threshold (GBP)', rate: PGL_REPAYMENT_RATE },
];

async function buildCountryThresholdExamples(country, year) {
  const rows = await Promise.all(SEO_THRESHOLD_PLANS.map(async (plan) => {
    try {
      const data = await getThresholdData(plan.key, year);
      const countryData = data[country];
      if (!countryData || !countryData[plan.field]) return null;
      const exchangeRate = parseExchangeRate(countryData['Exchange rate']);
      const thresholdGbp = parseGbpAmount(countryData[plan.field]);
      const rawCurrency = (countryData['Currency'] || '').replace(/[\s ]+/g, ' ').trim();
      const currencyCode = currencySymbol.NAME_TO_ISO[rawCurrency] || '';
      const exampleSalaryGbp = Number.isFinite(thresholdGbp) ? thresholdGbp + 10000 : NaN;
      const exampleSalaryLocal = Number.isFinite(exampleSalaryGbp) && Number.isFinite(exchangeRate) && exchangeRate > 0
        ? exampleSalaryGbp / exchangeRate
        : NaN;
      const thresholdLocal = Number.isFinite(thresholdGbp) && Number.isFinite(exchangeRate) && exchangeRate > 0
        ? thresholdGbp / exchangeRate
        : NaN;
      const exampleMonthly = Number.isFinite(exampleSalaryGbp) && Number.isFinite(thresholdGbp)
        ? ((exampleSalaryGbp - thresholdGbp) * plan.rate) / MONTHS_PER_YEAR
        : NaN;
      return {
        plan: plan.label,
        threshold: countryData[plan.field],
        exchangeRate: countryData['Exchange rate'] || 'n/a',
        exchangeRateValue: Number.isFinite(exchangeRate) ? exchangeRate : null,
        thresholdGbp,
        thresholdLocal: Number.isFinite(thresholdLocal) ? formatLocalAmount(thresholdLocal, currencyCode) : null,
        exampleSalaryLocal: Number.isFinite(exampleSalaryLocal) ? formatLocalAmount(exampleSalaryLocal, currencyCode) : null,
        exampleSalaryGbp: Number.isFinite(exampleSalaryGbp) ? formatGbp(exampleSalaryGbp) : null,
        exampleMonthly: Number.isFinite(exampleMonthly) ? formatGbp(exampleMonthly) : null,
        ratePercent: `${Math.round(plan.rate * 100)}%`,
        rate: plan.rate,
        currencyCode,
      };
    } catch (err) {
      logger.warn(`SEO threshold example failed: ${plan.key} ${country} ${year} — ${err.message}`);
      return null;
    }
  }));
  return rows.filter(Boolean);
}

function buildCountryPageSummary(page, thresholds) {
  const numericThresholds = thresholds
    .map((row) => row.thresholdGbp)
    .filter((threshold) => Number.isFinite(threshold));
  const primary = thresholds.find((row) => row.exampleSalaryLocal && row.exampleMonthly) || null;
  const currencyCodes = thresholds
    .map((row) => row.currencyCode)
    .filter(Boolean);
  const currencyCode = currencyCodes[0] || page.currency;

  return {
    currencyCode,
    planCount: thresholds.length,
    primaryExample: primary,
    thresholdRange: numericThresholds.length
      ? `${formatGbp(Math.min(...numericThresholds))} to ${formatGbp(Math.max(...numericThresholds))}`
      : null,
  };
}

function buildCountrySalaryExamples(page, thresholds) {
  const canCalculate = (row) => Number.isFinite(row.exchangeRateValue) && Number.isFinite(row.thresholdGbp);
  const plan2 = thresholds.find((row) => row.plan === 'Plan 2' && canCalculate(row));
  const primary = plan2 || thresholds.find(canCalculate);
  if (!primary || !Array.isArray(page.sampleSalaries)) return [];

  return page.sampleSalaries.map((salaryLocal) => {
    const salaryGbp = salaryLocal * primary.exchangeRateValue;
    const annualRepayment = Math.max(0, salaryGbp - primary.thresholdGbp) * primary.rate;
    const monthlyRepayment = annualRepayment / MONTHS_PER_YEAR;
    return {
      salaryLocal: formatLocalAmount(salaryLocal, page.currency),
      salaryGbp: formatGbp(salaryGbp),
      monthlyRepayment: formatGbp(monthlyRepayment),
      plan: primary.plan,
      ratePercent: primary.ratePercent,
    };
  });
}

function buildCountryEstimateChecks(page) {
  return [
    `Use gross annual income in ${page.currency} before local tax, social contributions, pension deductions, or other payroll deductions.`,
    'Choose the repayment plan named on your Student Loans Company account or overseas assessment letter.',
    'Include regular taxable bonuses, allowances, commission, or extra salary payments when they form part of your expected annual pay.',
    'Check whether you also have a Postgraduate Loan, because it is calculated separately and can be due alongside an undergraduate plan.',
    'Treat the estimate as a planning figure if you moved country part-way through the year or your SLC letter uses a different assessment period.',
  ];
}

function buildCountryCommonMistakes(page) {
  return [
    `Entering monthly take-home pay instead of annual gross ${page.currency} income.`,
    'Using a live bank or card exchange rate instead of the exchange rate from the SLC overseas threshold table.',
    'Selecting the wrong undergraduate plan because the overseas thresholds differ between Plan 1, Plan 2, Plan 4, and Plan 5.',
    'Leaving out a separate Postgraduate Loan repayment when one also applies.',
  ];
}

function buildPlanFaqs(page) {
  const isPostgraduate = page.plan === 'Postgraduate Loan';
  const rate = isPostgraduate ? '6%' : '9%';
  const planName = page.plan;
  return [
    {
      question: `Is ${planName} repaid at the same rate when I live overseas?`,
      answer: `${planName} overseas repayments are calculated at ${rate} of income above the relevant overseas threshold. The rate is familiar, but the threshold is country-specific rather than the normal UK payroll threshold.`,
    },
    {
      question: `Which income figure should I use for ${planName}?`,
      answer: 'Use gross annual income before local tax, social insurance, pension deductions, or other payroll deductions. If your pay includes regular bonuses or allowances, include them in the annual figure.',
    },
    {
      question: `Can I use the UK threshold for ${planName} while abroad?`,
      answer: 'No. Overseas repayments use the Student Loans Company overseas threshold table for your country of residence and tax year, so the UK payroll threshold is not the right comparison point.',
    },
    {
      question: isPostgraduate ? 'What if I also have an undergraduate loan?' : 'What if I also have a Postgraduate Loan?',
      answer: isPostgraduate
        ? 'A Postgraduate Loan can be due at the same time as an undergraduate Plan 1, Plan 2, Plan 4, or Plan 5 loan. Estimate each repayment separately and compare the combined result with SLC correspondence.'
        : 'A Postgraduate Loan is calculated separately at its own rate and threshold. If you have one, add that estimate to your undergraduate repayment estimate.',
    },
  ];
}

function buildCountryFaqs(page, taxYear) {
  return [
    {
      question: `Should I use gross or take-home pay in ${page.country}?`,
      answer: `Use gross annual income in ${page.currency} before local tax and payroll deductions. SLC overseas repayments are based on income compared with the published overseas threshold, not net take-home pay.`,
    },
    {
      question: `Can I use today's exchange rate for ${page.country}?`,
      answer: `For this guide, use the Student Loans Company overseas threshold table for ${taxYear}. The calculator follows the published table rate rather than a live market exchange rate.`,
    },
    {
      question: `What if I moved to or from ${page.country} during the year?`,
      answer: 'Use the calculator as an estimate and compare it with your SLC overseas assessment. Your official repayment can depend on the dates you were overseas, the evidence SLC requested, and the assessment period on your account.',
    },
    {
      question: `Do I include bonuses or allowances in ${page.country}?`,
      answer: 'Include regular taxable employment income where it forms part of your annual gross pay. If a payment is one-off or uncertain, run the calculator with and without it to see the possible range.',
    },
  ];
}

function buildGuideFaqs(page, taxYear) {
  return page.kind === 'country' ? buildCountryFaqs(page, taxYear) : buildPlanFaqs(page);
}

function buildSeoPageSchema(page, guideFaqs = []) {
  const pageUrl = `${SITE_URL}/${page.slug}`;
  const graph = [
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
  ];

  if (guideFaqs.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: guideFaqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
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
  const taxYear = getDefaultTaxYear();
  const thresholds = page.kind === 'country'
    ? await buildCountryThresholdExamples(page.country, taxYear)
    : [];
  const countrySummary = page.kind === 'country'
    ? buildCountryPageSummary(page, thresholds)
    : null;
  const salaryExamples = page.kind === 'country'
    ? buildCountrySalaryExamples(page, thresholds)
    : [];
  const estimateChecks = page.kind === 'country' ? buildCountryEstimateChecks(page) : [];
  const commonMistakes = page.kind === 'country' ? buildCountryCommonMistakes(page) : [];
  const guideFaqs = buildGuideFaqs(page, taxYear);

  return res.render('seo-page', {
    page,
    siteUrl: SITE_URL,
    taxYear,
    thresholds,
    countrySummary,
    salaryExamples,
    estimateChecks,
    commonMistakes,
    guideFaqs,
    lastReviewed: '8 May 2026',
    schemaJson: serializeJsonForHtml(buildSeoPageSchema(page, guideFaqs)),
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
    const includePg = pglAvailable && (profile ? !!profile.include_pg : preferenceCookie(req, 'includePg') === 'true');

    res.render('index', {
      countries,
      selectedPlan,
      selectedCountry,
      selectedYear,
      includePg,
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
    const includePg = pglAvailable && preferenceCookie(req, 'includePg') === 'true';
    res.render('index', {
      countries: [],
      selectedPlan,
      selectedCountry,
      selectedYear,
      includePg,
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
    return res.status(status).json({ error: message });
  }

  if (typeof targetCountry !== 'string' || !targetCountry.trim()) {
    return sendError(400, 'Please select a valid country.');
  }

  if (req.body.includePg !== undefined && req.body.includePg !== 'on') {
    return sendError(400, 'Invalid Postgraduate Loan selection.');
  }
  const includePg = req.body.includePg === 'on';
  logger.info(`Handling POST /calculate: country=${targetCountry}, plan=${selectedPlan}, year=${year}, includePg=${includePg}`);

  if (!SUPPORTED_YEARS.includes(year)) {
    return sendError(400, 'Invalid tax year selected.');
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

    const thresholdGbp = parseGbpAmount(thresholdRaw);
    if (!Number.isFinite(thresholdGbp)) {
      return sendError(502, 'Unexpected data format for this country. Please try again later.');
    }

    const plan2LowerThresholdGbp = selectedPlan === 'plan2'
      ? thresholdGbp
      : null;
    const plan2UpperThresholdRaw = selectedPlan === 'plan2'
      ? countryData['Upper earnings threshold (GBP)']
      : null;
    const plan2UpperThresholdGbp = plan2UpperThresholdRaw
      ? parseGbpAmount(plan2UpperThresholdRaw)
      : null;
    if (selectedPlan === 'plan2' && !Number.isFinite(plan2UpperThresholdGbp)) {
      return sendError(502, 'Unexpected data format for this country. Please try again later.');
    }

    const salaryGbp = salary * exchangeRate;
    const amountOverThreshold = salaryGbp - thresholdGbp;

    if (hasPreferenceConsent(req)) {
      res.cookie('selectedPlan', selectedPlan, COOKIE_OPTS);
      res.cookie('selectedCountry', targetCountry, COOKIE_OPTS);
      res.cookie('selectedYear', year, COOKIE_OPTS);
      res.cookie('includePg', String(includePg), COOKIE_OPTS);
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

      pglThresholdGbp = parseGbpAmount(pgThresholdRaw);
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

    return res.json({
      monthlyRepayment: monthlyRepayment.toFixed(2),
      pglMonthlyRepayment: pglMonthlyRepayment !== null ? pglMonthlyRepayment.toFixed(2) : null,
      pglThresholdGbp: pglThresholdGbp !== null ? pglThresholdGbp.toFixed(2) : null,
      thresholdGbp: thresholdGbp.toFixed(2),
      plan2LowerThresholdGbp: plan2LowerThresholdGbp !== null ? plan2LowerThresholdGbp.toFixed(2) : null,
      plan2UpperThresholdGbp: plan2UpperThresholdGbp !== null ? plan2UpperThresholdGbp.toFixed(2) : null,
      localPerGbp: (1 / exchangeRate).toFixed(4),
      salaryGbp: salaryGbp.toFixed(2),
      selectedPlan,
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
