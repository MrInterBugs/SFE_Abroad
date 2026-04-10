const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');
const { urlsByYear, CACHE_DURATION, DEFAULT_YEAR } = require('../config/constants');
const db = require('./db');

// In-memory cache keyed by "plan:year", stores full data dict
const cache = {};
const cacheTimestamp = {};

function cacheKey(plan, year) {
  return `${plan}:${year}`;
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

async function fetchFromWeb(plan, year) {
  const url = urlsByYear[year][plan];
  logger.info(`Fetching from gov.uk: ${plan} ${year}`);
  const response = await axios.get(url);
  if (response.status !== 200) {
    throw new Error(`gov.uk returned status ${response.status}`);
  }
  const countryDataDict = parseTableData(response.data);

  // Persist to DB and in-memory cache
  db.saveThresholds(plan, year, countryDataDict);
  const key = cacheKey(plan, year);
  cache[key] = countryDataDict;
  cacheTimestamp[key] = Date.now();

  return countryDataDict;
}

/**
 * Returns the full country data dict for a plan+year.
 * For non-current years, serves from DB once cached — never re-fetches from gov.uk.
 * For the current year, falls back to DB only if gov.uk is unreachable.
 */
async function getThresholdData(plan, year) {
  const key = cacheKey(plan, year);
  const now = Date.now();

  if (cache[key] && (now - cacheTimestamp[key] < CACHE_DURATION)) {
    logger.info(`Memory cache hit: ${plan} ${year}`);
    return cache[key];
  }

  // Old year: if it's in the DB, use it permanently — gov.uk may remove the page.
  if (year !== DEFAULT_YEAR) {
    const dbData = db.loadThresholds(plan, year);
    if (dbData) {
      logger.info(`DB cache hit (archived year): ${plan} ${year}`);
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

  if (cache[key] && (now - cacheTimestamp[key] < CACHE_DURATION)) {
    return Object.keys(cache[key]);
  }

  // Old year: serve from DB only, never re-fetch.
  if (year !== DEFAULT_YEAR) {
    const dbList = db.loadCountryList(plan, year);
    if (dbList.length > 0) {
      logger.info(`DB country list hit (archived year): ${plan} ${year}`);
      return dbList;
    }
  }

  // Current year or not yet in DB — do a full fetch.
  const data = await getThresholdData(plan, year);
  return Object.keys(data);
}

module.exports = { fetchCountryData, getThresholdData };
