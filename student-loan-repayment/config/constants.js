const urls = {
    plan1: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-1-student-loans/overseas-earnings-thresholds-for-plan-1-student-loans-2024-25',
    plan2: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-2-student-loans/overseas-earnings-thresholds-for-plan-2-student-loans-2024-25',
    plan4: 'https://www.gov.uk/government/publications/overseas-earnings-thresholds-for-plan-4-student-loans/overseas-earnings-thresholds-for-plan-4-student-loans-2024-25',
  };
  
  const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  
  module.exports = { urls, CACHE_DURATION };
  