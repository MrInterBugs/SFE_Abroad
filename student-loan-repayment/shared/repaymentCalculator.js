const {
  MONTHS_PER_YEAR,
  PRIMARY_PLAN_KEYS,
  repaymentRateForPlan,
  isPlanAvailableForYear,
} = require('./calculator-domain');
const {
  normalizeThresholdRow,
  isUsablePrimaryThreshold,
  isUsablePgThreshold,
} = require('./thresholdData');
const { SUPPORTED_YEARS, urlsByYear } = require('../config/constants');

const MAX_CALCULATION_SALARY = 1_000_000_000;

class CalculationError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CalculationError';
    this.status = status;
  }
}

function parseRequiredNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  return Number(raw);
}

function floorRepaymentPounds(value) {
  return Math.floor(Math.max(0, value));
}

function checkedFormFlag(body, key, invalidMessage) {
  if (body[key] !== undefined && body[key] !== 'on') {
    throw new CalculationError(400, invalidMessage);
  }
  return body[key] === 'on';
}

function validateCalculationRequest(body) {
  const { targetCountry, selectedPlan, selectedYear } = body;
  const year = selectedYear;

  if (typeof targetCountry !== 'string' || !targetCountry.trim()) {
    throw new CalculationError(400, 'Please select a valid country.');
  }

  const includePg = checkedFormFlag(body, 'includePg', 'Invalid Postgraduate Loan selection.');
  const noUndergradLoan = checkedFormFlag(body, 'noUndergradLoan', 'Invalid undergraduate loan selection.');

  if (!SUPPORTED_YEARS.includes(year)) {
    throw new CalculationError(400, 'Invalid tax year selected.');
  }

  if (!noUndergradLoan && !PRIMARY_PLAN_KEYS.includes(selectedPlan)) {
    throw new CalculationError(400, 'Invalid repayment plan selected.');
  }

  if (!noUndergradLoan && !isPlanAvailableForYear(urlsByYear, selectedPlan, year)) {
    throw new CalculationError(400, 'Selected repayment plan is not available for this tax year.');
  }

  if (includePg && !isPlanAvailableForYear(urlsByYear, 'planPg', year)) {
    throw new CalculationError(400, 'Postgraduate Loan data is not available for this tax year.');
  }

  if (noUndergradLoan && !includePg) {
    throw new CalculationError(400, 'Select Postgraduate Loan to calculate without an undergraduate loan.');
  }

  const salary = parseRequiredNumber(body.salaryLocalCurrency);
  if (!Number.isFinite(salary) || salary <= 0 || salary > MAX_CALCULATION_SALARY) {
    throw new CalculationError(400, 'Please enter a valid positive salary.');
  }

  return {
    targetCountry,
    selectedUndergradPlan: noUndergradLoan ? null : selectedPlan,
    year,
    includePg,
    noUndergradLoan,
    salary,
  };
}

function formatNullablePounds(value) {
  return value !== null ? value.toFixed(2) : null;
}

function calculateRepayment(input, { primaryCountryData, pgCountryData = null, profile = null }) {
  const countryData = primaryCountryData?.[input.targetCountry];
  if (!countryData) {
    throw new CalculationError(400, 'Country not found in the data.');
  }

  const effectivePlan = input.noUndergradLoan ? 'planPg' : input.selectedUndergradPlan;
  const primaryThreshold = normalizeThresholdRow(countryData, effectivePlan);
  if (!isUsablePrimaryThreshold(primaryThreshold)) {
    throw new CalculationError(502, 'Unexpected data format for this country. Please try again later.');
  }

  const salaryGbp = input.salary * primaryThreshold.exchangeRate;
  if (!Number.isFinite(salaryGbp)) {
    throw new CalculationError(400, 'Please enter a valid positive salary.');
  }

  const amountOverThreshold = salaryGbp - primaryThreshold.thresholdGbp;
  const primaryRepaymentRate = repaymentRateForPlan(effectivePlan);
  const monthlyRepayment = !input.noUndergradLoan && amountOverThreshold > 0
    ? floorRepaymentPounds((amountOverThreshold * primaryRepaymentRate) / MONTHS_PER_YEAR)
    : 0;

  let pglMonthlyRepayment = null;
  let pglThresholdGbp = null;
  if (input.includePg) {
    const pgRow = input.noUndergradLoan
      ? countryData
      : pgCountryData?.[input.targetCountry];
    const pgThreshold = normalizeThresholdRow(pgRow, 'planPg');
    if (!isUsablePgThreshold(pgThreshold)) {
      throw new CalculationError(502, 'Unexpected postgraduate loan data format for this country. Please try again later.');
    }

    pglThresholdGbp = pgThreshold.thresholdGbp;
    const pgAmountOver = salaryGbp - pglThresholdGbp;
    pglMonthlyRepayment = pgAmountOver > 0
      ? floorRepaymentPounds((pgAmountOver * repaymentRateForPlan('planPg')) / MONTHS_PER_YEAR)
      : 0;
  }

  return {
    monthlyRepayment: monthlyRepayment.toFixed(2),
    pglMonthlyRepayment: formatNullablePounds(pglMonthlyRepayment),
    pglThresholdGbp: formatNullablePounds(pglThresholdGbp),
    thresholdGbp: primaryThreshold.thresholdGbp.toFixed(2),
    plan2LowerThresholdGbp: formatNullablePounds(primaryThreshold.plan2LowerThresholdGbp),
    plan2UpperThresholdGbp: formatNullablePounds(primaryThreshold.plan2UpperThresholdGbp),
    localPerGbp: (1 / primaryThreshold.exchangeRate).toFixed(4),
    salaryGbp: salaryGbp.toFixed(2),
    selectedPlan: input.selectedUndergradPlan,
    effectivePlan,
    noUndergradLoan: input.noUndergradLoan,
    selectedYear: input.year,
    salaryCurrencySymbol: primaryThreshold.currencySymbol,
    loanValueGbp: profile?.loan_value_gbp || null,
    loanValuePglGbp: profile?.loan_value_pgl_gbp || null,
  };
}

module.exports = {
  MAX_CALCULATION_SALARY,
  CalculationError,
  validateCalculationRequest,
  calculateRepayment,
  floorRepaymentPounds,
};
