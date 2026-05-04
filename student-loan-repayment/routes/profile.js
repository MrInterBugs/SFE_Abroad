const express = require('express');
const { verifyCsrfToken } = require('../utils/csrf');
const { getUserById, getProfile, upsertProfile, deleteUser, loadCountryList, getCalculationsForUser } = require('../utils/db');
const { requireAuth } = require('../utils/auth');
const { getCurrentTaxYear, ALLOWED_PLANS } = require('../config/constants');
const logger = require('../utils/logger');

const UG_PLANS = ALLOWED_PLANS.filter(p => p !== 'planPg');

const router = express.Router();

function getCountries() {
  return loadCountryList('plan1', getCurrentTaxYear());
}

function parseOptionalNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return Number(raw);
}

router.get('/profile', requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);
  const profile = getProfile(req.session.userId);
  res.render('profile', { user, profile: profile || {}, countries: getCountries(), ugPlans: UG_PLANS, error: null, success: false, csrfToken: res.locals.csrfToken });
});

router.get('/profile/export', requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);
  const profile = getProfile(req.session.userId);
  const calculations = getCalculationsForUser(req.session.userId);
  const exportedAt = new Date().toISOString();

  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="student-finance-overseas-data-${user.id}.json"`,
  });

  res.send(JSON.stringify({
    exported_at: exportedAt,
    account: {
      id: user.id,
      email: user.email,
      email_confirmed_at: user.email_confirmed_at ? new Date(user.email_confirmed_at).toISOString() : null,
      created_at: new Date(user.created_at).toISOString(),
    },
    profile: profile ? {
      graduation_date: profile.graduation_date,
      loan_value_gbp: profile.loan_value_gbp,
      loan_value_pgl_gbp: profile.loan_value_pgl_gbp,
      default_country: profile.default_country,
      default_plan: profile.default_plan,
      include_pg: Boolean(profile.include_pg),
      default_salary: profile.default_salary,
      updated_at: profile.updated_at ? new Date(profile.updated_at).toISOString() : null,
    } : null,
    calculations: calculations.map(c => ({
      id: c.id,
      country: c.country,
      plan: c.plan,
      tax_year: c.tax_year,
      salary_local: c.salary_local,
      salary_gbp: c.salary_gbp,
      exchange_rate: c.exchange_rate,
      threshold_gbp: c.threshold_gbp,
      monthly_repayment: c.monthly_repayment,
      include_pg: Boolean(c.include_pg),
      pgl_monthly_repayment: c.pgl_monthly_repayment,
      pgl_threshold_gbp: c.pgl_threshold_gbp,
      calculated_at: new Date(c.calculated_at).toISOString(),
    })),
  }, null, 2));
});

router.post('/profile', requireAuth, verifyCsrfToken, (req, res) => {
  const { graduationDate, loanValueGbp, loanValuePglGbp, defaultCountry, defaultPlan, includePg, defaultSalary } = req.body;
  const user = getUserById(req.session.userId);
  const countries = getCountries();

  const parsedLoan    = parseOptionalNumber(loanValueGbp);
  const parsedPglLoan = parseOptionalNumber(loanValuePglGbp);
  const parsedSalary  = parseOptionalNumber(defaultSalary);

  const renderError = (msg) => res.status(400).render('profile', { user, profile: req.body, countries, ugPlans: UG_PLANS, error: msg, success: false, csrfToken: res.locals.csrfToken });

  if (parsedLoan    !== null && (!isFinite(parsedLoan)    || parsedLoan    < 0)) return renderError('Please enter a valid undergraduate loan value.');
  if (parsedPglLoan !== null && (!isFinite(parsedPglLoan) || parsedPglLoan < 0)) return renderError('Please enter a valid postgraduate loan value.');
  if (parsedSalary  !== null && (!isFinite(parsedSalary)  || parsedSalary  < 0)) return renderError('Please enter a valid salary.');
  if (graduationDate && !/^\d{4}-\d{2}$/.test(graduationDate))                  return renderError('Please enter a valid graduation date.');
  if (defaultPlan && !UG_PLANS.includes(defaultPlan))                            return renderError('Invalid repayment plan selected.');
  if (defaultCountry && !countries.includes(defaultCountry))                     return renderError('Invalid default country selected.');

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
