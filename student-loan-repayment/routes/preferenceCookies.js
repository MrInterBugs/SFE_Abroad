const { hasCookieConsent } = require('../utils/consent');
const { COOKIE_MAX_AGE } = require('../config/constants');

const COOKIE_OPTS = {
  maxAge: COOKIE_MAX_AGE,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
};

const CLEAR_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
};

const PREFERENCE_COOKIE_NAMES = [
  'selectedPlan',
  'selectedCountry',
  'selectedYear',
  'includePg',
  'noUndergradLoan',
];

function hasPreferenceConsent(req) {
  return hasCookieConsent(req, 'preferences');
}

function preferenceCookie(req, name) {
  return hasPreferenceConsent(req) ? req.cookies[name] : undefined;
}

function clearPreferenceCookies(res) {
  PREFERENCE_COOKIE_NAMES.forEach((name) => res.clearCookie(name, CLEAR_COOKIE_OPTS));
}

module.exports = {
  COOKIE_OPTS,
  CLEAR_COOKIE_OPTS,
  hasPreferenceConsent,
  preferenceCookie,
  clearPreferenceCookies,
};
