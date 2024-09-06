const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');
const { urls, CACHE_DURATION } = require('../config/constants');

let cache = {
  plan1: null,
  plan2: null,
  plan4: null
};

let cacheTimestamp = {
  plan1: 0,
  plan2: 0,
  plan4: 0,
};

const fetchCountryData = async (plan) => {
  const currentTime = Date.now();

  logger.info(`Checking cache validity for ${plan}...`);
  if (cache[plan] && (currentTime - cacheTimestamp[plan] < CACHE_DURATION)) {
    logger.info(`Cache is valid for ${plan}. Returning cached data.`);
    return cache[plan];
  }

  logger.info(`Cache is expired or missing for ${plan}. Fetching new data from URL...`);
  try {
    const response = await axios.get(urls[plan]);
    if (response.status === 200) {
      const $ = cheerio.load(response.data);
      const countryList = [];
      $('table tr').each((i, element) => {
        if (i === 0) return; // Skip header row
        const countryName = $(element).find('td').first().text().trim();
        countryList.push(countryName);
      });

      cache[plan] = countryList;
      cacheTimestamp[plan] = currentTime;

      logger.info(`Data fetched and cache updated for ${plan}. Returning new data.`);
      return countryList;
    }
  } catch (error) {
    logger.error(`Error fetching data for ${plan}: ${error.message}`);
    throw new Error(`Error: ${error.message}`);
  }
};

module.exports = fetchCountryData;
