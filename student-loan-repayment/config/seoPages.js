const SITE_URL = 'https://sfe.aedanl.com';

const PLAN_PAGES = [
  {
    slug: 'plan-1-overseas-repayment',
    kind: 'plan',
    plan: 'Plan 1',
    title: 'Plan 1 Overseas Student Loan Repayment',
    metaTitle: 'Plan 1 Overseas Student Loan Repayment Calculator',
    description: 'Learn how Plan 1 UK student loan repayments work when you live overseas, including thresholds, the 9% repayment rate, and how to estimate your monthly payment.',
    intro: 'Plan 1 overseas repayments use country-specific earnings thresholds. If your converted annual income is above the threshold for the country where you live, Student Finance expects 9% of the amount above that threshold.',
  },
  {
    slug: 'plan-2-overseas-repayment',
    kind: 'plan',
    plan: 'Plan 2',
    title: 'Plan 2 Overseas Student Loan Repayment',
    metaTitle: 'Plan 2 Overseas Student Loan Repayment Calculator',
    description: 'Check how Plan 2 student loan repayments are calculated for UK graduates living abroad, with overseas thresholds, exchange rates, and monthly repayment examples.',
    intro: 'Plan 2 repayments overseas follow the same 9% rate used in the UK, but the earnings threshold varies by country and tax year.',
  },
  {
    slug: 'plan-4-overseas-repayment',
    kind: 'plan',
    plan: 'Plan 4',
    title: 'Plan 4 Overseas Student Loan Repayment',
    metaTitle: 'Plan 4 Overseas Student Loan Repayment Calculator',
    description: 'Estimate Plan 4 student loan repayments while living abroad. See how overseas thresholds and local salary conversion affect Scottish student loan payments.',
    intro: 'Plan 4 applies to Scottish student loans. Overseas repayments are calculated after converting your salary to GBP and comparing it with the threshold for your country of residence.',
  },
  {
    slug: 'plan-5-overseas-repayment',
    kind: 'plan',
    plan: 'Plan 5',
    title: 'Plan 5 Overseas Student Loan Repayment',
    metaTitle: 'Plan 5 Overseas Student Loan Repayment Calculator',
    description: 'Understand Plan 5 overseas student loan repayments for UK graduates abroad, including the 9% repayment rate, country thresholds, and salary conversion.',
    intro: 'Plan 5 is the newer undergraduate repayment plan for England and Wales. Overseas repayments still use 9% of converted income above the relevant country threshold.',
  },
  {
    slug: 'postgraduate-loan-overseas-repayment',
    kind: 'plan',
    plan: 'Postgraduate Loan',
    title: 'Postgraduate Loan Overseas Repayment',
    metaTitle: 'Postgraduate Loan Overseas Repayment Calculator',
    description: 'Work out how Postgraduate Loan repayments are calculated overseas, including the 6% repayment rate, overseas earnings thresholds, and combined repayments.',
    intro: 'Postgraduate Loans use a 6% repayment rate above the overseas threshold. If you also have an undergraduate loan, both repayments can apply at the same time.',
  },
];

const COUNTRY_PAGES = [
  {
    slug: 'student-loan-overseas-repayment-germany',
    kind: 'country',
    country: 'Germany',
    currency: 'EUR',
    title: 'UK Student Loan Repayment While Living in Germany',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Germany',
    description: 'Estimate UK student loan repayments for graduates living in Germany. Convert your euro salary and compare it with Student Loans Company overseas thresholds.',
  },
  {
    slug: 'student-loan-overseas-repayment-australia',
    kind: 'country',
    country: 'Australia',
    currency: 'AUD',
    title: 'UK Student Loan Repayment While Living in Australia',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Australia',
    description: 'Calculate UK student loan repayments for graduates living in Australia using overseas repayment thresholds, exchange rates, and plan-specific repayment rates.',
  },
  {
    slug: 'student-loan-overseas-repayment-canada',
    kind: 'country',
    country: 'Canada',
    currency: 'CAD',
    title: 'UK Student Loan Repayment While Living in Canada',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Canada',
    description: 'Estimate UK student loan repayments from Canada. See how local salary, exchange rates, and overseas Student Loans Company thresholds affect monthly payments.',
  },
];

const SEO_PAGES = [...PLAN_PAGES, ...COUNTRY_PAGES];

function getSeoPage(slug) {
  return SEO_PAGES.find((page) => page.slug === slug) || null;
}

module.exports = {
  SITE_URL,
  PLAN_PAGES,
  COUNTRY_PAGES,
  SEO_PAGES,
  getSeoPage,
};
