const currencySymbol = require('../utils/currencySymbol');
const domain = require('../public/calculator-domain');

function parseGbpAmount(value) {
  if (typeof value !== 'string') return NaN;
  return parseFloat(value.replace(/[£,]/g, ''));
}

function parseExchangeRate(value) {
  return parseFloat(String(value ?? '').replace(/,/g, ''));
}

function rawCurrencyName(row) {
  return (row?.Currency || '').replace(/[\s ]+/g, ' ').trim();
}

function currencyCodeForRow(row) {
  return currencySymbol.NAME_TO_ISO[rawCurrencyName(row)] || '';
}

function normalizeThresholdRow(row, plan) {
  if (!row) return null;

  const thresholdField = domain.thresholdFieldForPlan(plan);
  const thresholdRaw = thresholdField ? row[thresholdField] : undefined;
  const exchangeRate = parseExchangeRate(row['Exchange rate']);
  const thresholdGbp = parseGbpAmount(thresholdRaw);

  const normalized = {
    raw: row,
    plan,
    thresholdField,
    thresholdRaw,
    exchangeRate,
    thresholdGbp,
    currencyName: rawCurrencyName(row),
    currencyCode: currencyCodeForRow(row),
    currencySymbol: currencySymbol(row.Currency || ''),
    plan2LowerThresholdGbp: null,
    plan2UpperThresholdGbp: null,
  };

  if (plan === 'plan2') {
    const upperField = domain.upperThresholdFieldForPlan(plan);
    const upperRaw = upperField ? row[upperField] : undefined;
    normalized.plan2LowerThresholdGbp = thresholdGbp;
    normalized.plan2UpperThresholdRaw = upperRaw;
    normalized.plan2UpperThresholdGbp = parseGbpAmount(upperRaw);
  }

  return normalized;
}

function isUsablePrimaryThreshold(normalized) {
  if (!normalized) return false;
  if (!Number.isFinite(normalized.exchangeRate) || normalized.exchangeRate <= 0) return false;
  if (!Number.isFinite(normalized.thresholdGbp)) return false;
  if (normalized.plan === 'plan2' && !Number.isFinite(normalized.plan2UpperThresholdGbp)) return false;
  return true;
}

function isUsablePgThreshold(normalized) {
  return Boolean(normalized && Number.isFinite(normalized.thresholdGbp));
}

module.exports = {
  parseGbpAmount,
  parseExchangeRate,
  rawCurrencyName,
  currencyCodeForRow,
  normalizeThresholdRow,
  isUsablePrimaryThreshold,
  isUsablePgThreshold,
};
