const logger = require('./logger');
const { REPAYMENT_RATE, PGL_REPAYMENT_RATE, MONTHS_PER_YEAR } = require('../config/constants');
const { SITE_URL } = require('../config/seoPages');
const { getThresholdData } = require('./fetchCountryData');
const currencySymbol = require('./currencySymbol');

const SEO_THRESHOLD_PLANS = [
  { key: 'plan1', label: 'Plan 1', field: 'Earnings threshold (GBP)', rate: REPAYMENT_RATE },
  { key: 'plan2', label: 'Plan 2', field: 'Lower earnings threshold (GBP)', rate: REPAYMENT_RATE },
  { key: 'plan4', label: 'Plan 4', field: 'Earnings threshold (GBP)', rate: REPAYMENT_RATE },
  { key: 'plan5', label: 'Plan 5', field: 'Earnings threshold (GBP)', rate: REPAYMENT_RATE },
  { key: 'planPg', label: 'Postgraduate Loan', field: 'Earnings threshold (GBP)', rate: PGL_REPAYMENT_RATE },
];

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

function buildSeoPageSchema(page, guideFaqs) {
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
      {
        '@type': 'FAQPage',
        mainEntity: guideFaqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.answer,
          },
        })),
      },
    ],
  };
}

function serializeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

async function buildSeoPageViewModel(page, taxYear) {
  const thresholds = page.kind === 'country'
    ? await buildCountryThresholdExamples(page.country, taxYear)
    : [];
  const guideFaqs = buildGuideFaqs(page, taxYear);

  return {
    page,
    siteUrl: SITE_URL,
    taxYear,
    thresholds,
    countrySummary: page.kind === 'country' ? buildCountryPageSummary(page, thresholds) : null,
    salaryExamples: page.kind === 'country' ? buildCountrySalaryExamples(page, thresholds) : [],
    estimateChecks: page.kind === 'country' ? buildCountryEstimateChecks(page) : [],
    commonMistakes: page.kind === 'country' ? buildCountryCommonMistakes(page) : [],
    guideFaqs,
    lastReviewed: '8 May 2026',
    schemaJson: serializeJsonForHtml(buildSeoPageSchema(page, guideFaqs)),
  };
}

module.exports = {
  buildSeoPageViewModel,
  buildCountryThresholdExamples,
  buildCountryPageSummary,
  buildCountrySalaryExamples,
  buildGuideFaqs,
  buildSeoPageSchema,
  parseGbpAmount,
  serializeJsonForHtml,
};
