const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');
const { urlsByYear, CACHE_DURATION, getCurrentTaxYear } = require('../config/constants');
const { thresholdFieldForPlan } = require('../shared/calculator-domain');
const db = require('./db');

// In-memory cache keyed by "plan:year", stores full data dict
const cache = {};
const cacheTimestamp = {};

const OVERRIDES_PATH = path.join(__dirname, '..', 'data', 'overrides.json');

function cacheKey(plan, year) {
  return `${plan}:${year}`;
}

function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function parseTableData(html) {
  const $ = cheerio.load(html);
  const headers = [];
  const countryDataDict = {};

  $('table th').each((i, el) => {
    headers.push($(el).text().trim());
  });

  $('table tr').each((i, el) => {
    if (i === 0) return;
    const columns = $(el).find('td');
    const countryName = $(columns[0]).text().trim();
    if (!countryName) return;
    const data = {};
    for (let j = 1; j < headers.length; j++) {
      data[headers[j]] = $(columns[j]).text().trim();
    }
    countryDataDict[countryName] = data;
  });

  return countryDataDict;
}

function validateParsedData(countryDataDict, plan, source) {
  if (!countryDataDict || typeof countryDataDict !== 'object' || Array.isArray(countryDataDict)) {
    throw new Error(`Invalid ${source} for ${plan}`);
  }

  const entries = Object.entries(countryDataDict);
  if (entries.length === 0) {
    throw new Error(`No country data found in ${source} for ${plan}`);
  }

  const threshField = thresholdFieldForPlan(plan);
  for (const [country, row] of entries) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Invalid row for ${country} in ${source} for ${plan}`);
    }
    if (!('Exchange rate' in row) || !String(row['Exchange rate']).trim()) {
      throw new Error(`Expected "Exchange rate" column not found for ${country} in ${source} for ${plan}`);
    }
    if (threshField && (!(threshField in row) || !String(row[threshField]).trim())) {
      throw new Error(`Expected "${threshField}" column not found for ${country} in ${source} for ${plan}`);
    }
  }
}

async function fetchFromWeb(plan, year) {
  const url = urlsByYear[year][plan];
  logger.info(`Fetching from gov.uk: ${plan} ${year}`);
  const response = await axios.get(url, { timeout: 10000 });
  if (response.status !== 200) {
    throw new Error(`gov.uk returned status ${response.status}`);
  }
  const countryDataDict = parseTableData(response.data);
  validateParsedData(countryDataDict, plan, 'gov.uk data');

  // Persist to DB and in-memory cache
  db.saveThresholds(plan, year, countryDataDict);
  const key = cacheKey(plan, year);
  cache[key] = countryDataDict;
  cacheTimestamp[key] = Date.now();

  return countryDataDict;
}

/**
 * Returns the full country data dict for a plan+year.
 * Priority: overrides.json > in-memory cache > DB cache > gov.uk fetch.
 * For non-current tax years, serves from DB once cached — gov.uk may remove older pages.
 * For the current year, falls back to DB only if gov.uk is unreachable.
 */
async function getThresholdData(plan, year) {
  const key = cacheKey(plan, year);
  const now = Date.now();
  const currentTaxYear = getCurrentTaxYear();

  // Manual override file takes absolute precedence — allows emergency data correction
  // without a code change or image rebuild. Edit data/overrides.json on the host.
  const overrides = loadOverrides();
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    validateParsedData(overrides[key], plan, 'overrides.json');
    logger.info(`Override in use for ${plan} ${year} — skipping gov.uk fetch`);
    return overrides[key];
  }

  if (cache[key] && (now - cacheTimestamp[key] < CACHE_DURATION)) {
    logger.debug(`Memory cache hit: ${plan} ${year}`);
    return cache[key];
  }

  // Older/future configured years: prefer DB when available because gov.uk may
  // remove or rename archived pages.
  if (year !== currentTaxYear) {
    const dbData = db.loadThresholds(plan, year);
    if (dbData) {
      logger.debug(`DB cache hit (archived year): ${plan} ${year}`);
      cache[key] = dbData;
      cacheTimestamp[key] = now;
      return dbData;
    }
  }

  try {
    return await fetchFromWeb(plan, year);
  } catch (error) {
    logger.warn(`gov.uk fetch failed for ${plan} ${year}: ${error.message} — trying DB cache`);
    const dbData = db.loadThresholds(plan, year);
    if (dbData) return dbData;
    throw new Error(`Data unavailable for ${plan} ${year}: ${error.message}`);
  }
}

/**
 * Returns just the list of country names for autocomplete.
 */
async function fetchCountryData(plan, year) {
  const key = cacheKey(plan, year);
  const now = Date.now();
  const currentTaxYear = getCurrentTaxYear();

  if (cache[key] && (now - cacheTimestamp[key] < CACHE_DURATION)) {
    return Object.keys(cache[key]);
  }

  // Non-current year: serve from DB first, then fall back to a full fetch.
  if (year !== currentTaxYear) {
    const dbList = db.loadCountryList(plan, year);
    if (dbList.length > 0) {
      logger.debug(`DB country list hit (archived year): ${plan} ${year}`);
      return dbList;
    }
  }

  // Current year or not yet in DB — do a full fetch.
  const data = await getThresholdData(plan, year);
  return Object.keys(data);
}

module.exports = { fetchCountryData, getThresholdData };
