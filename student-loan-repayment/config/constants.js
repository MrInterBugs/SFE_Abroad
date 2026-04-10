// 2025-26 URLs for plans 1/2/4 use "2024-25" in the path due to a typo on gov.uk.
// Plan 5 2026-27 uses "2026-to-2027" in the path (different format to other plans).
const urlsByYear = {
  '2025-26': {
    plan1: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-1-student-loans/overseas-earnings-thresholds-for-plan-1-student-loans-2024-25',
    plan2: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-2-student-loans/overseas-earnings-thresholds-for-plan-2-student-loans-2024-25',
    plan4: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-4-student-loans/overseas-earnings-thresholds-for-plan-4-student-loans-2024-25',
    plan5: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-5-student-loans/overseas-earnings-thresholds-for-plan-5-student-loans-2025-26',
  },
  '2026-27': {
    plan1: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-1-student-loans/overseas-earnings-thresholds-for-plan-1-student-loans-2026-27',
    plan2: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-2-student-loans/overseas-earnings-thresholds-for-plan-2-student-loans-2026-27',
    plan4: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-4-student-loans/overseas-earnings-thresholds-for-plan-4-student-loans-2026-27',
    plan5: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-5-student-loans/overseas-earnings-thresholds-for-plan-5-student-loans-2026-to-2027',
  },
};

const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const DEFAULT_YEAR = '2026-27';
const SUPPORTED_YEARS = Object.keys(urlsByYear);

module.exports = { urlsByYear, CACHE_DURATION, DEFAULT_YEAR, SUPPORTED_YEARS };
  