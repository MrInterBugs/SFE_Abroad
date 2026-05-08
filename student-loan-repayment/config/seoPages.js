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
    who: 'Plan 1 commonly applies to older English and Welsh undergraduate loans, and to Northern Irish student loans. If your SLC account or letter says Plan 1, use this plan even if you now live outside the UK.',
    overseasNotes: [
      'The overseas threshold is not one global figure. It changes by country, because SLC publishes country-specific thresholds and exchange rates.',
      'For Plan 1, the repayment rate is 9% of converted income above the overseas threshold. Income below the threshold should produce a zero repayment estimate.',
    ],
    checklist: [
      'Confirm your account says Plan 1 rather than Plan 2, Plan 4, or Plan 5.',
      'Enter gross annual salary in your local currency before local income tax.',
      'Compare the result with your SLC overseas repayment notice before making payment decisions.',
    ],
  },
  {
    slug: 'plan-2-overseas-repayment',
    kind: 'plan',
    plan: 'Plan 2',
    title: 'Plan 2 Overseas Student Loan Repayment',
    metaTitle: 'Plan 2 Overseas Student Loan Repayment Calculator',
    description: 'Check how Plan 2 student loan repayments are calculated for UK graduates living abroad, with overseas thresholds, exchange rates, and monthly repayment examples.',
    intro: 'Plan 2 repayments overseas follow the same 9% rate used in the UK, but the earnings threshold varies by country and tax year.',
    who: 'Plan 2 usually applies to English and Welsh undergraduate loans for courses started from 2012 until Plan 5 began. Overseas borrowers still use country-specific thresholds rather than the UK payroll threshold.',
    overseasNotes: [
      'Plan 2 overseas tables include lower and upper threshold figures. This calculator uses the lower overseas threshold to estimate the repayment amount.',
      'The repayment amount is 9% of converted income above the lower threshold. Interest treatment is separate from the monthly repayment estimate.',
    ],
    checklist: [
      'Use Plan 2 if that is the plan shown on your SLC account.',
      'Use gross annual salary and the country where you are resident for repayment purposes.',
      'If you also have a Postgraduate Loan, calculate it as an additional repayment.',
    ],
  },
  {
    slug: 'plan-4-overseas-repayment',
    kind: 'plan',
    plan: 'Plan 4',
    title: 'Plan 4 Overseas Student Loan Repayment',
    metaTitle: 'Plan 4 Overseas Student Loan Repayment Calculator',
    description: 'Estimate Plan 4 student loan repayments while living abroad. See how overseas thresholds and local salary conversion affect Scottish student loan payments.',
    intro: 'Plan 4 applies to Scottish student loans. Overseas repayments are calculated after converting your salary to GBP and comparing it with the threshold for your country of residence.',
    who: 'Plan 4 is normally used for Scottish student loans administered through SAAS/SLC. If you studied in Scotland and now live overseas, your repayment notice may use Plan 4 thresholds.',
    overseasNotes: [
      'Plan 4 has its own overseas threshold table, so it should not be estimated using Plan 1 or Plan 2 figures.',
      'The repayment rate is 9% of converted income above the Plan 4 overseas threshold for your country.',
    ],
    checklist: [
      'Check your SLC account or overseas assessment letter for Plan 4.',
      'Use the local salary currency for your country of residence.',
      'Remember that the estimate does not include account-specific interest or arrears arrangements.',
    ],
  },
  {
    slug: 'plan-5-overseas-repayment',
    kind: 'plan',
    plan: 'Plan 5',
    title: 'Plan 5 Overseas Student Loan Repayment',
    metaTitle: 'Plan 5 Overseas Student Loan Repayment Calculator',
    description: 'Understand Plan 5 overseas student loan repayments for UK graduates abroad, including the 9% repayment rate, country thresholds, and salary conversion.',
    intro: 'Plan 5 is the newer undergraduate repayment plan for England and Wales. Overseas repayments still use 9% of converted income above the relevant country threshold.',
    who: 'Plan 5 applies to newer English and Welsh undergraduate borrowers. Because Plan 5 is newer, checking the exact plan on your SLC account is especially important before estimating overseas payments.',
    overseasNotes: [
      'Plan 5 has its own overseas threshold publication and should not be treated as Plan 2 with a different name.',
      'The calculator applies 9% only to the amount of converted income above the Plan 5 overseas threshold.',
    ],
    checklist: [
      'Confirm that your course and account are on Plan 5.',
      'Use the latest tax year available in the calculator.',
      'Check whether you have any separate Postgraduate Loan balance.',
    ],
  },
  {
    slug: 'postgraduate-loan-overseas-repayment',
    kind: 'plan',
    plan: 'Postgraduate Loan',
    title: 'Postgraduate Loan Overseas Repayment',
    metaTitle: 'Postgraduate Loan Overseas Repayment Calculator',
    description: 'Work out how Postgraduate Loan repayments are calculated overseas, including the 6% repayment rate, overseas earnings thresholds, and combined repayments.',
    intro: 'Postgraduate Loans use a 6% repayment rate above the overseas threshold. If you also have an undergraduate loan, both repayments can apply at the same time.',
    who: 'Postgraduate Loans are separate from undergraduate repayment plans. Graduates overseas can owe a Postgraduate Loan repayment at the same time as a Plan 1, 2, 4, or 5 repayment.',
    overseasNotes: [
      'The Postgraduate Loan rate is 6% above the overseas threshold, not 9%.',
      'If you have both undergraduate and postgraduate balances, calculate both and add the monthly estimates together.',
    ],
    checklist: [
      'Check whether your postgraduate balance is separate from your undergraduate loan.',
      'Use the Postgraduate Loan threshold for your country, not the undergraduate threshold.',
      'Compare combined repayments with SLC correspondence if you have multiple loan types.',
    ],
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
    localNotes: [
      'Use your gross annual euro salary before German income tax, solidarity surcharge, church tax, or social insurance deductions.',
      'Germany is a common destination for UK graduates, so checking the SLC exchange rate against the tax-year table is more useful than using a live EUR/GBP rate.',
    ],
    sampleSalaries: [30000, 50000, 70000],
  },
  {
    slug: 'student-loan-overseas-repayment-australia',
    kind: 'country',
    country: 'Australia',
    currency: 'AUD',
    title: 'UK Student Loan Repayment While Living in Australia',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Australia',
    description: 'Calculate UK student loan repayments for graduates living in Australia using overseas repayment thresholds, exchange rates, and plan-specific repayment rates.',
    localNotes: [
      'Enter gross annual salary in Australian dollars before PAYG withholding, Medicare levy, or superannuation deductions.',
      'If your income includes overtime or casual loading, annualise the gross amount before comparing it with SLC overseas thresholds.',
    ],
    sampleSalaries: [60000, 90000, 120000],
  },
  {
    slug: 'student-loan-overseas-repayment-canada',
    kind: 'country',
    country: 'Canada',
    currency: 'CAD',
    title: 'UK Student Loan Repayment While Living in Canada',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Canada',
    description: 'Estimate UK student loan repayments from Canada. See how local salary, exchange rates, and overseas Student Loans Company thresholds affect monthly payments.',
    localNotes: [
      'Use gross Canadian dollar income before federal or provincial tax deductions.',
      'If your pay varies by province or includes bonuses, use a full-year gross estimate rather than monthly take-home pay.',
    ],
    sampleSalaries: [50000, 80000, 110000],
  },
  {
    slug: 'student-loan-overseas-repayment-usa',
    kind: 'country',
    country: 'United States of America',
    currency: 'USD',
    title: 'UK Student Loan Repayment While Living in the USA',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator USA',
    description: 'Estimate UK student loan repayments for graduates living in the United States. See how your dollar salary converts to GBP and how it compares to SLC overseas thresholds.',
    localNotes: [
      'Enter gross annual US dollar income before federal, state, local, Social Security, or Medicare deductions.',
      'US compensation can include bonus, commission, or equity income; include taxable employment income where it forms part of your annual gross pay.',
    ],
    sampleSalaries: [50000, 80000, 120000],
  },
  {
    slug: 'student-loan-overseas-repayment-new-zealand',
    kind: 'country',
    country: 'New Zealand',
    currency: 'NZD',
    title: 'UK Student Loan Repayment While Living in New Zealand',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator New Zealand',
    description: 'Calculate UK student loan repayments for graduates living in New Zealand. Convert your NZD salary and compare it with Student Loans Company overseas thresholds.',
    localNotes: [
      'Use gross annual New Zealand dollar income before PAYE, ACC earner levy, KiwiSaver, or student loan deductions in New Zealand.',
      'If you moved mid-year, estimate the annualised salary you expect while resident in New Zealand.',
    ],
    sampleSalaries: [60000, 90000, 120000],
  },
  {
    slug: 'student-loan-overseas-repayment-uae',
    kind: 'country',
    country: 'United Arab Emirates',
    currency: 'AED',
    title: 'UK Student Loan Repayment While Living in the UAE',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator UAE',
    description: 'Estimate UK student loan repayments for graduates living in the United Arab Emirates. See how your AED salary converts and how overseas SLC thresholds apply.',
    localNotes: [
      'Use gross annual salary in UAE dirhams, including regular allowances if they form part of your employment package.',
      'Even where local income tax is not deducted, SLC overseas repayments are still based on gross income compared with the published country threshold.',
    ],
    sampleSalaries: [180000, 300000, 450000],
  },
  {
    slug: 'student-loan-overseas-repayment-france',
    kind: 'country',
    country: 'France',
    currency: 'EUR',
    title: 'UK Student Loan Repayment While Living in France',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator France',
    description: 'Estimate UK student loan repayments for graduates living in France. Convert your euro salary and compare it with the Student Loans Company overseas earnings thresholds.',
    localNotes: [
      'Enter gross annual euro salary before French income tax and social contribution deductions.',
      'If you are paid a 13th month or regular bonus, include it in the annual gross figure before calculating.',
    ],
    sampleSalaries: [30000, 45000, 65000],
  },
  {
    slug: 'student-loan-overseas-repayment-netherlands',
    kind: 'country',
    country: 'Netherlands',
    currency: 'EUR',
    title: 'UK Student Loan Repayment While Living in the Netherlands',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Netherlands',
    description: 'Calculate UK student loan repayments for graduates living in the Netherlands. See how your euro salary and overseas SLC thresholds determine your monthly payment.',
    localNotes: [
      'Use gross annual euro salary before Dutch payroll tax, social insurance, pension contributions, or holiday allowance deductions.',
      'If your contract lists monthly salary plus vakantiegeld, include the holiday allowance in the annual total.',
    ],
    sampleSalaries: [35000, 55000, 75000],
  },
  {
    slug: 'student-loan-overseas-repayment-ireland',
    kind: 'country',
    country: 'Ireland',
    currency: 'EUR',
    title: 'UK Student Loan Repayment While Living in Ireland',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Ireland',
    description: 'Estimate UK student loan repayments for graduates living in Ireland. Enter your gross salary in euros and see your estimated monthly SLC overseas repayment.',
    localNotes: [
      'Use gross annual euro salary before Irish PAYE, USC, PRSI, or pension deductions.',
      'Ireland uses euros, but SLC still applies its own overseas threshold and exchange rate table rather than a live conversion rate.',
    ],
    sampleSalaries: [35000, 55000, 80000],
  },
  {
    slug: 'student-loan-overseas-repayment-spain',
    kind: 'country',
    country: 'Spain',
    currency: 'EUR',
    title: 'UK Student Loan Repayment While Living in Spain',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Spain',
    description: 'Calculate UK student loan repayments for graduates living in Spain. Convert your euro salary and compare it with Student Loans Company overseas earnings thresholds.',
    localNotes: [
      'Enter gross annual euro salary before Spanish income tax, social security, or regional deductions.',
      'If you receive 14 salary payments, add them together as an annual gross amount before estimating your SLC repayment.',
    ],
    sampleSalaries: [25000, 40000, 60000],
  },
  {
    slug: 'student-loan-overseas-repayment-sweden',
    kind: 'country',
    country: 'Sweden',
    currency: 'SEK',
    title: 'UK Student Loan Repayment While Living in Sweden',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Sweden',
    description: 'Estimate UK student loan repayments for graduates living in Sweden. See how your Swedish krona salary converts to GBP and how overseas SLC thresholds apply.',
    localNotes: [
      'Use gross annual Swedish krona salary before municipal tax, state tax, or pension deductions.',
      'If your pay is negotiated monthly, multiply the gross monthly amount by 12 and include regular taxable allowances.',
    ],
    sampleSalaries: [420000, 600000, 850000],
  },
  {
    slug: 'student-loan-overseas-repayment-switzerland',
    kind: 'country',
    country: 'Switzerland',
    currency: 'CHF',
    title: 'UK Student Loan Repayment While Living in Switzerland',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Switzerland',
    description: 'Calculate UK student loan repayments for graduates living in Switzerland. Convert your CHF salary and compare it with Student Loans Company overseas thresholds.',
    localNotes: [
      'Use gross annual Swiss franc salary before cantonal tax, social security, pension, or accident insurance deductions.',
      'Swiss salaries are often high relative to overseas thresholds, so small exchange-rate differences can noticeably change the estimate.',
    ],
    sampleSalaries: [70000, 100000, 140000],
  },
  {
    slug: 'student-loan-overseas-repayment-singapore',
    kind: 'country',
    country: 'Singapore',
    currency: 'SGD',
    title: 'UK Student Loan Repayment While Living in Singapore',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Singapore',
    description: 'Estimate UK student loan repayments for graduates living in Singapore. See how your SGD salary converts to GBP and how overseas SLC earnings thresholds are applied.',
    localNotes: [
      'Enter gross annual Singapore dollar salary before income tax, CPF contributions, or regular employment deductions.',
      'If your package includes an annual wage supplement or fixed bonus, include it in the annual gross salary estimate.',
    ],
    sampleSalaries: [60000, 90000, 130000],
  },
  {
    slug: 'student-loan-overseas-repayment-japan',
    kind: 'country',
    country: 'Japan',
    currency: 'JPY',
    title: 'UK Student Loan Repayment While Living in Japan',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Japan',
    description: 'Calculate UK student loan repayments for graduates living in Japan. Convert your yen salary and compare it with Student Loans Company overseas earnings thresholds.',
    localNotes: [
      'Use gross annual Japanese yen income before income tax, resident tax, pension, or health insurance deductions.',
      'If your employer pays bonuses twice a year, add expected bonuses to base salary before estimating the repayment.',
    ],
    sampleSalaries: [5000000, 8000000, 12000000],
  },
  {
    slug: 'student-loan-overseas-repayment-south-africa',
    kind: 'country',
    country: 'South Africa',
    currency: 'ZAR',
    title: 'UK Student Loan Repayment While Living in South Africa',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator South Africa',
    description: 'Estimate UK student loan repayments for graduates living in South Africa. See how your rand salary converts to GBP and how overseas SLC thresholds affect your payment.',
    localNotes: [
      'Enter gross annual rand salary before PAYE, UIF, retirement annuity, or medical aid deductions.',
      'If your salary is paid monthly with a 13th cheque or annual bonus, include the expected annual amount.',
    ],
    sampleSalaries: [450000, 750000, 1100000],
  },
  {
    slug: 'student-loan-overseas-repayment-hong-kong',
    kind: 'country',
    country: 'Hong Kong',
    currency: 'HKD',
    title: 'UK Student Loan Repayment While Living in Hong Kong',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Hong Kong',
    description: 'Calculate UK student loan repayments for graduates living in Hong Kong. Convert your HKD salary and compare it with Student Loans Company overseas earnings thresholds.',
    localNotes: [
      'Use gross annual Hong Kong dollar salary before salaries tax, MPF contributions, or other payroll deductions.',
      'If your contract includes a guaranteed annual bonus or double pay, include it in the annual gross figure.',
    ],
    sampleSalaries: [360000, 600000, 900000],
  },
  {
    slug: 'student-loan-overseas-repayment-norway',
    kind: 'country',
    country: 'Norway',
    currency: 'NOK',
    title: 'UK Student Loan Repayment While Living in Norway',
    metaTitle: 'UK Student Loan Overseas Repayment Calculator Norway',
    description: 'Estimate UK student loan repayments for graduates living in Norway. See how your Norwegian krone salary converts to GBP and how overseas SLC thresholds apply.',
    localNotes: [
      'Enter gross annual Norwegian krone salary before income tax, national insurance, pension, or holiday pay deductions.',
      'If your annual income includes feriepenger, include it when estimating gross yearly earnings for SLC purposes.',
    ],
    sampleSalaries: [550000, 800000, 1100000],
  },
];

const SEO_PAGES = [...PLAN_PAGES, ...COUNTRY_PAGES];
const STATIC_INDEXABLE_PAGES = [
  { path: '/', changefreq: 'monthly', priority: '1.0' },
  { path: '/methodology', changefreq: 'monthly', priority: '0.8' },
  { path: '/about', changefreq: 'yearly', priority: '0.6' },
];

function getSeoPage(slug) {
  return SEO_PAGES.find((page) => page.slug === slug) || null;
}

function getSeoPagePaths() {
  return SEO_PAGES.map((page) => `/${page.slug}`);
}

function getSitemapEntries(lastmod) {
  const seoEntries = SEO_PAGES.map((page) => ({
    path: `/${page.slug}`,
    changefreq: 'monthly',
    priority: page.kind === 'country' ? '0.9' : '0.8',
  }));

  return [...STATIC_INDEXABLE_PAGES, ...seoEntries].map((entry) => ({
    loc: entry.path === '/' ? `${SITE_URL}/` : `${SITE_URL}${entry.path}`,
    lastmod,
    changefreq: entry.changefreq,
    priority: entry.priority,
  }));
}

module.exports = {
  SITE_URL,
  PLAN_PAGES,
  COUNTRY_PAGES,
  SEO_PAGES,
  STATIC_INDEXABLE_PAGES,
  getSeoPage,
  getSeoPagePaths,
  getSitemapEntries,
};
