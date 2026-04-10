const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'thresholds.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS cached_thresholds (
    plan TEXT NOT NULL,
    year TEXT NOT NULL,
    country_name TEXT NOT NULL,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (plan, year, country_name)
  )
`);

function saveThresholds(plan, year, countryDataDict) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO cached_thresholds (plan, year, country_name, data, fetched_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((entries) => {
    for (const [countryName, data] of Object.entries(entries)) {
      insert.run(plan, year, countryName, JSON.stringify(data), Date.now());
    }
  });
  insertMany(countryDataDict);
  logger.info(`DB: saved ${Object.keys(countryDataDict).length} countries for ${plan} ${year}`);
}

function loadThresholds(plan, year) {
  const rows = db.prepare(`
    SELECT country_name, data FROM cached_thresholds
    WHERE plan = ? AND year = ?
  `).all(plan, year);

  if (rows.length === 0) return null;

  const result = {};
  for (const row of rows) {
    result[row.country_name] = JSON.parse(row.data);
  }
  logger.info(`DB: loaded ${rows.length} countries for ${plan} ${year}`);
  return result;
}

function loadCountryList(plan, year) {
  const rows = db.prepare(`
    SELECT country_name FROM cached_thresholds
    WHERE plan = ? AND year = ?
    ORDER BY country_name
  `).all(plan, year);
  return rows.map(r => r.country_name);
}

module.exports = { saveThresholds, loadThresholds, loadCountryList };
