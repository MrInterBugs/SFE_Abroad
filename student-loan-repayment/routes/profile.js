const express = require('express');
const { verifyCsrfToken } = require('../utils/csrf');
const { getUserById, getProfile, upsertProfile, deleteUser } = require('../utils/db');
const { requireAuth } = require('../utils/auth');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/profile', requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);
  const profile = getProfile(req.session.userId);
  res.render('profile', { user, profile: profile || {}, error: null, success: false, csrfToken: res.locals.csrfToken });
});

router.post('/profile', requireAuth, verifyCsrfToken, (req, res) => {
  const { graduationDate, loanValueGbp, loanValuePglGbp } = req.body;
  const user = getUserById(req.session.userId);

  const parsedLoan = loanValueGbp !== '' ? parseFloat(loanValueGbp) : null;
  const parsedPglLoan = loanValuePglGbp !== '' ? parseFloat(loanValuePglGbp) : null;

  if (parsedLoan !== null && (!isFinite(parsedLoan) || parsedLoan < 0)) {
    return res.status(400).render('profile', { user, profile: req.body, error: 'Please enter a valid undergraduate loan value.', success: false, csrfToken: res.locals.csrfToken });
  }
  if (parsedPglLoan !== null && (!isFinite(parsedPglLoan) || parsedPglLoan < 0)) {
    return res.status(400).render('profile', { user, profile: req.body, error: 'Please enter a valid postgraduate loan value.', success: false, csrfToken: res.locals.csrfToken });
  }
  if (graduationDate && !/^\d{4}-\d{2}$/.test(graduationDate)) {
    return res.status(400).render('profile', { user, profile: req.body, error: 'Please enter a valid graduation date.', success: false, csrfToken: res.locals.csrfToken });
  }

  try {
    upsertProfile(req.session.userId, {
      graduationDate: graduationDate || null,
      loanValueGbp: parsedLoan,
      loanValuePglGbp: parsedPglLoan,
    });
    logger.info(`Profile updated for user id=${req.session.userId}`);
    const updatedProfile = getProfile(req.session.userId);
    res.render('profile', { user, profile: updatedProfile || {}, error: null, success: true, csrfToken: res.locals.csrfToken });
  } catch (err) {
    logger.error(`Profile update error: ${err.message}`);
    res.status(500).render('profile', { user, profile: req.body, error: 'Something went wrong. Please try again.', success: false, csrfToken: res.locals.csrfToken });
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
