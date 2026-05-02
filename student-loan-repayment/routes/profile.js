const express = require('express');
const { verifyCsrfToken } = require('../utils/csrf');
const { getUserById, getProfile, upsertProfile, deleteUser, loadCountryList } = require('../utils/db');
const { requireAuth } = require('../utils/auth');
const { getCurrentTaxYear, ALLOWED_PLANS } = require('../config/constants');
const logger = require('../utils/logger');

const UG_PLANS = ALLOWED_PLANS.filter(p => p !== 'planPg');

const router = express.Router();

function getCountries() {
  return loadCountryList('plan1', getCurrentTaxYear());
}

router.get('/profile', requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);
  const profile = getProfile(req.session.userId);
  res.render('profile', { user, profile: profile || {}, countries: getCountries(), ugPlans: UG_PLANS, error: null, success: false, csrfToken: res.locals.csrfToken });
});

router.post('/profile', requireAuth, verifyCsrfToken, (req, res) => {
  const { graduationDate, loanValueGbp, loanValuePglGbp, defaultCountry, defaultPlan, includePg, defaultSalary } = req.body;
  const user = getUserById(req.session.userId);
  const countries = getCountries();

  const parsedLoan    = loanValueGbp    !== '' ? parseFloat(loanValueGbp)    : null;
  const parsedPglLoan = loanValuePglGbp !== '' ? parseFloat(loanValuePglGbp) : null;
  const parsedSalary  = defaultSalary   !== '' ? parseFloat(defaultSalary)   : null;

  const renderError = (msg) => res.status(400).render('profile', { user, profile: req.body, countries, ugPlans: UG_PLANS, error: msg, success: false, csrfToken: res.locals.csrfToken });

  if (parsedLoan    !== null && (!isFinite(parsedLoan)    || parsedLoan    < 0)) return renderError('Please enter a valid undergraduate loan value.');
  if (parsedPglLoan !== null && (!isFinite(parsedPglLoan) || parsedPglLoan < 0)) return renderError('Please enter a valid postgraduate loan value.');
  if (parsedSalary  !== null && (!isFinite(parsedSalary)  || parsedSalary  < 0)) return renderError('Please enter a valid salary.');
  if (graduationDate && !/^\d{4}-\d{2}$/.test(graduationDate))                  return renderError('Please enter a valid graduation date.');
  if (defaultPlan && !UG_PLANS.includes(defaultPlan))                            return renderError('Invalid repayment plan selected.');

  try {
    upsertProfile(req.session.userId, {
      graduationDate:  graduationDate  || null,
      loanValueGbp:    parsedLoan,
      loanValuePglGbp: parsedPglLoan,
      defaultCountry:  defaultCountry  || null,
      defaultPlan:     defaultPlan     || null,
      includePg:       includePg === 'on',
      defaultSalary:   parsedSalary,
    });
    logger.info(`Profile updated for user id=${req.session.userId}`);
    const updatedProfile = getProfile(req.session.userId);
    res.render('profile', { user, profile: updatedProfile || {}, countries, ugPlans: UG_PLANS, error: null, success: true, csrfToken: res.locals.csrfToken });
  } catch (err) {
    logger.error(`Profile update error: ${err.message}`);
    res.status(500).render('profile', { user, profile: req.body, countries, ugPlans: UG_PLANS, error: 'Something went wrong. Please try again.', success: false, csrfToken: res.locals.csrfToken });
  }
});

router.post('/profile/delete', requireAuth, verifyCsrfToken, (req, res) => {
  const userId = req.session.userId;
  req.session.destroy(() => {
    deleteUser(userId);
    res.redirect('/');
  });
});

module.exports = router;
