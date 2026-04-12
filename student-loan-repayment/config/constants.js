// URL quirks:
// - 2025-26 for plans 1/2/4 use "2024-25" in the path (gov.uk typo)
// - Postgraduate 2025-26 has the same typo (path reads "2024-25")
// - Plan 5 2026-27 uses "2026-to-2027" instead of "2026-27"
const urlsByYear = {
  '2025-26': {
    plan1:   'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-1-student-loans/overseas-earnings-thresholds-for-plan-1-student-loans-2024-25',
    plan2:   'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-2-student-loans/overseas-earnings-thresholds-for-plan-2-student-loans-2024-25',
    plan4:   'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-4-student-loans/overseas-earnings-thresholds-for-plan-4-student-loans-2024-25',
    plan5:   'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-5-student-loans/overseas-earnings-thresholds-for-plan-5-student-loans-2025-26',
    planPg:  'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-postgraduate-student-loans/overseas-earnings-thresholds-for-postgraduate-student-loans-2024-25',
  },
  '2026-27': {
    plan1:   'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-1-student-loans/overseas-earnings-thresholds-for-plan-1-student-loans-2026-27',
    plan2:   'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-2-student-loans/overseas-earnings-thresholds-for-plan-2-student-loans-2026-27',
    plan4:   'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-4-student-loans/overseas-earnings-thresholds-for-plan-4-student-loans-2026-27',
    plan5:   'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-5-student-loans/overseas-earnings-thresholds-for-plan-5-student-loans-2026-to-2027',
    planPg:  'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-postgraduate-student-loans/overseas-earnings-thresholds-for-postgraduate-student-loans-2026-27',
  },
};

const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

const REPAYMENT_RATE = 0.09;     // 9% above threshold (all undergraduate plans)
const PGL_REPAYMENT_RATE = 0.06; // 6% above threshold (postgraduate loan)
const MONTHS_PER_YEAR = 12;

const ALLOWED_PLANS = ['plan1', 'plan2', 'plan4', 'plan5'];
const SUPPORTED_YEARS = Object.keys(urlsByYear);

// Latest supported year — used as the fallback for the "archived year" DB logic.
const DEFAULT_YEAR = SUPPORTED_YEARS[SUPPORTED_YEARS.length - 1];

// Returns the UK tax year string for today (e.g. '2026-27').
// The UK tax year starts on 6 April, so before that date we're still in the
// previous year. Falls back to DEFAULT_YEAR if the computed year isn't supported.
function getCurrentTaxYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed
  const day = now.getDate();
  const afterTaxYearStart = month > 4 || (month === 4 && day >= 6);
  const startYear = afterTaxYearStart ? year : year - 1;
  const endYear = startYear + 1;
  const computed = `${startYear}-${String(endYear).slice(2)}`;
  return SUPPORTED_YEARS.includes(computed) ? computed : DEFAULT_YEAR;
}

module.exports = {
  urlsByYear,
  CACHE_DURATION,
  COOKIE_MAX_AGE,
  REPAYMENT_RATE,
  PGL_REPAYMENT_RATE,
  MONTHS_PER_YEAR,
  ALLOWED_PLANS,
  DEFAULT_YEAR,
  SUPPORTED_YEARS,
  getCurrentTaxYear,
};
  