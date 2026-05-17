const logger = require('../utils/logger');
const currencySymbol = require('../utils/currencySymbol');
const db = require('../utils/db');
const {
  DEFAULT_YEAR,
  SUPPORTED_YEARS,
  computeCurrentTaxYear,
  urlsByYear,
} = require('../config/constants');
const {
  primaryPlansForYear,
  availablePlansForYear,
  isPlanAvailableForYear: domainIsPlanAvailableForYear,
} = require('../shared/calculator-domain');
const {
  PLAN_PAGES,
  COUNTRY_PAGES,
  FEATURED_COUNTRY_SLUGS,
} = require('../config/seoPages');
const { preferenceCookie } = require('./preferenceCookies');

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
  return primaryPlansForYear(urlsByYear, year);
}

function isPlanAvailableForYear(plan, year) {
  return domainIsPlanAvailableForYear(urlsByYear, plan, year);
}

function buildAvailablePlansByYear() {
  return Object.fromEntries(
    SUPPORTED_YEARS.map((year) => [year, availablePlansForYear(urlsByYear, year)])
  );
}

function resolveSelectedPlan(req, profile, year) {
  const availablePlans = getAvailablePlansForYear(year);
  const fallbackPlan = availablePlans[0];
  if (profile?.default_plan && availablePlans.includes(profile.default_plan)) return profile.default_plan;
  const cookiePlan = preferenceCookie(req, 'selectedPlan');
  return availablePlans.includes(cookiePlan) ? cookiePlan : fallbackPlan;
}

function taxYearState(req) {
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

  return {
    selectedYear,
    realCurrentTaxYear,
    currentTaxYearSupported,
    taxYearNotice,
  };
}

function featuredCountryPages() {
  return FEATURED_COUNTRY_SLUGS
    .map((slug) => COUNTRY_PAGES.find((page) => page.slug === slug))
    .filter(Boolean);
}

function buildIndexViewModel(req, {
  countries,
  profile,
  selectedYear,
  realCurrentTaxYear,
  currentTaxYearSupported,
  taxYearNotice,
}) {
  const selectedPlan = resolveSelectedPlan(req, profile, selectedYear);
  const selectedCountry = profile?.default_country || preferenceCookie(req, 'selectedCountry') || '';
  const pglAvailable = isPlanAvailableForYear('planPg', selectedYear);
  const noUndergradLoan = pglAvailable && preferenceCookie(req, 'noUndergradLoan') === 'true';
  const includePg = pglAvailable && (
    noUndergradLoan ||
    (profile ? !!profile.include_pg : preferenceCookie(req, 'includePg') === 'true')
  );

  return {
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
    featuredCountryPages: featuredCountryPages(),
    graduationDate: profile?.graduation_date || null,
    loanValueGbp: profile?.loan_value_gbp || null,
    loanValuePglGbp: profile?.loan_value_pgl_gbp || null,
    defaultSalary: profile?.default_salary || null,
  };
}

async function buildHomeViewModel(req, loadThresholdData) {
  const yearState = taxYearState(req);

  try {
    const fullData = await loadThresholdData('plan1', yearState.selectedYear);
    const countries = buildCountriesList(fullData);
    const profile = req.session.userId ? db.getProfile(req.session.userId) : null;
    return buildIndexViewModel(req, { countries, profile, ...yearState });
  } catch (error) {
    logger.error(`Error loading data: ${error.message}`);
    return buildIndexViewModel(req, { countries: [], profile: null, ...yearState });
  }
}

module.exports = {
  buildCountriesList,
  getAvailablePlansForYear,
  isPlanAvailableForYear,
  buildAvailablePlansByYear,
  resolveSelectedPlan,
  buildHomeViewModel,
};
