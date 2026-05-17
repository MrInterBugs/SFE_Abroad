(function () {
  const helpers = typeof require === 'function'
    ? require('./calculator-helpers')
    : window.SFECalculatorHelpers;
  const consentModule = typeof require === 'function'
    ? require('./calculator-consent')
    : window.SFECalculatorConsent;
  const graphModule = typeof require === 'function'
    ? require('./calculator-graph')
    : window.SFECalculatorGraph;

  const appData = JSON.parse(document.getElementById('app-data').textContent);
  const COUNTRIES = appData.countries;
  const GRADUATION_DATE = appData.graduationDate || null;
  const AVAILABLE_PLANS_BY_YEAR = appData.availablePlansByYear || {};

  let selectedCountry = null;
  let acHighlightIdx = -1;

  const countryInput = document.getElementById('country-input');
  const acList = document.getElementById('ac-list');
  const currencyBadge = document.getElementById('currency-badge');
  const pglCheck = document.getElementById('pgl-check');
  const pglRow = document.getElementById('pgl-row');
  const noUgCheck = document.getElementById('no-ug-check');
  const noUgRow = document.getElementById('no-ug-row');
  const pglDivider = document.getElementById('pgl-divider');
  const form = document.getElementById('calc-form');
  const resultsCard = document.getElementById('results-card');
  const calcBtn = document.getElementById('calc-btn');

  const graph = graphModule.createRepaymentGraph({
    document,
    window,
    graduationDate: GRADUATION_DATE,
  });
  const necessaryCookies = consentModule.createNecessaryCookieController({
    document,
    window,
    form,
    hideInlineError,
  });

  necessaryCookies.init();
  graph.initControls();
  syncPlanAvailability();
  selectServerRenderedCountry();

  function queryAll(selector) {
    return typeof document.querySelectorAll === 'function' ? document.querySelectorAll(selector) : [];
  }

  function selectServerRenderedCountry() {
    const cookieCountry = countryInput.value.trim();
    if (!cookieCountry) return;
    const match = COUNTRIES.find(c => c.name === cookieCountry);
    if (match) selectCountry(match);
  }

  function filterCountries(q) {
    if (!q) return [];
    const lower = q.toLowerCase();
    return COUNTRIES.filter(c => c.name.toLowerCase().includes(lower)).slice(0, 8);
  }

  function renderAC(items) {
    acList.innerHTML = '';
    acHighlightIdx = -1;
    if (items.length === 0) {
      acList.classList.remove('open');
      return;
    }
    items.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'ac-item';
      div.setAttribute('role', 'option');
      const currencyLabel = [c.currency, c.symbol].filter(Boolean).join(' · ');
      const acCountry = document.createElement('span');
      acCountry.className = 'ac-country';
      acCountry.textContent = c.name;
      const acCurrency = document.createElement('span');
      acCurrency.className = 'ac-currency';
      acCurrency.textContent = currencyLabel;
      div.appendChild(acCountry);
      div.appendChild(acCurrency);
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectCountry(c);
      });
      acList.appendChild(div);
    });
    acList.classList.add('open');
  }

  function selectCountry(c) {
    selectedCountry = c;
    countryInput.value = c.name;
    currencyBadge.textContent = c.symbol || c.currency || '—';
    acList.classList.remove('open');
    document.getElementById('country-error').classList.remove('show');
    countryInput.classList.remove('error');
  }

  countryInput.addEventListener('input', () => {
    selectedCountry = null;
    currencyBadge.textContent = '—';
    renderAC(filterCountries(countryInput.value));
  });

  countryInput.addEventListener('keydown', (e) => {
    const items = acList.querySelectorAll('.ac-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acHighlightIdx = Math.min(acHighlightIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('highlighted', i === acHighlightIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acHighlightIdx = Math.max(acHighlightIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('highlighted', i === acHighlightIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = acHighlightIdx >= 0 ? acHighlightIdx : 0;
      const q = filterCountries(countryInput.value);
      if (q[idx]) selectCountry(q[idx]);
    } else if (e.key === 'Escape') {
      acList.classList.remove('open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrap')) {
      acList.classList.remove('open');
    }
  });

  pglCheck.addEventListener('change', () => {
    if (!pglCheck.checked && noUgCheck) {
      noUgCheck.checked = false;
      noUgRow.classList.remove('checked');
    }
    pglRow.classList.toggle('checked', pglCheck.checked);
  });

  if (noUgCheck) {
    noUgCheck.addEventListener('change', () => {
      noUgRow.classList.toggle('checked', noUgCheck.checked);
      if (noUgCheck.checked) {
        queryAll('input[name="selectedPlan"]').forEach((input) => { input.checked = false; });
        pglCheck.checked = true;
        pglRow.classList.add('checked');
      } else if (!document.querySelector('input[name="selectedPlan"]:checked')) {
        const firstAvailablePlan = document.querySelector('.plan-card[data-plan]:not([hidden]) input[name="selectedPlan"]');
        if (firstAvailablePlan) firstAvailablePlan.checked = true;
      }
    });
  }

  queryAll('input[name="selectedYear"]').forEach((input) => {
    input.addEventListener('change', syncPlanAvailability);
  });
  queryAll('input[name="selectedPlan"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked && noUgCheck) {
        noUgCheck.checked = false;
        noUgRow.classList.remove('checked');
      }
      syncPlanAvailability();
    });
  });

  function syncPlanAvailability() {
    const selectedYearInput = document.querySelector('input[name="selectedYear"]:checked');
    const selectedYear = selectedYearInput ? selectedYearInput.value : '';
    const availablePlans = helpers.availablePlansForYear(AVAILABLE_PLANS_BY_YEAR, selectedYear);
    const availableSet = new Set(availablePlans);
    let selectedVisiblePlan = document.querySelector('input[name="selectedPlan"]:checked');

    queryAll('.plan-card[data-plan]').forEach((card) => {
      const plan = card.dataset.plan;
      const input = card.querySelector('input[name="selectedPlan"]');
      const available = availableSet.has(plan);
      card.hidden = !available;
      if (input) {
        input.disabled = !available;
        if (!available && input.checked) input.checked = false;
      }
    });

    const pglAvailable = availableSet.has('planPg');
    pglRow.hidden = !pglAvailable;
    if (noUgRow) noUgRow.hidden = !pglAvailable;
    if (pglDivider) pglDivider.hidden = !pglAvailable;
    pglCheck.disabled = !pglAvailable;
    if (noUgCheck) noUgCheck.disabled = !pglAvailable;
    if (!pglAvailable) {
      pglCheck.checked = false;
      if (noUgCheck) noUgCheck.checked = false;
      pglRow.classList.remove('checked');
      if (noUgRow) noUgRow.classList.remove('checked');
    } else {
      if (noUgCheck && noUgCheck.checked) pglCheck.checked = true;
      pglRow.classList.toggle('checked', pglCheck.checked);
      if (noUgRow) noUgRow.classList.toggle('checked', Boolean(noUgCheck && noUgCheck.checked));
    }

    if (noUgCheck && noUgCheck.checked && pglAvailable) {
      queryAll('input[name="selectedPlan"]').forEach((input) => { input.checked = false; });
    } else {
      selectedVisiblePlan = document.querySelector('input[name="selectedPlan"]:checked');
      if (!selectedVisiblePlan || selectedVisiblePlan.disabled) {
        const firstAvailablePlan = document.querySelector('.plan-card[data-plan]:not([hidden]) input[name="selectedPlan"]');
        if (firstAvailablePlan) firstAvailablePlan.checked = true;
      }
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let valid = true;

    if (!selectedCountry) {
      document.getElementById('country-error').classList.add('show');
      countryInput.classList.add('error');
      valid = false;
    }

    const salaryInput = document.getElementById('salary-input');
    const salaryRaw = String(salaryInput.value || '').trim();
    const salary = salaryRaw ? Number(salaryRaw) : NaN;
    if (!Number.isFinite(salary) || salary <= 0) {
      document.getElementById('salary-error').classList.add('show');
      salaryInput.classList.add('error');
      valid = false;
    } else {
      document.getElementById('salary-error').classList.remove('show');
      salaryInput.classList.remove('error');
    }

    if (!valid) return;

    hideInlineError();
    calcBtn.disabled = true;
    calcBtn.textContent = 'Calculating…';

    try {
      const csrfInput = document.getElementById('csrf-input');
      let csrfToken = csrfInput.value;

      if (!csrfToken) {
        const tokenResp = await fetch('/csrf-token', {
          headers: { 'Accept': 'application/json' },
        });

        if (!tokenResp.ok) {
          necessaryCookies.requireConsentThenRetry();
          return;
        }

        const tokenData = await tokenResp.json();
        csrfToken = tokenData.csrfToken;
        csrfInput.value = csrfToken;
      }

      const body = new URLSearchParams(new FormData(form));

      const resp = await fetch('/calculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: body.toString(),
      });

      const contentType = resp.headers && typeof resp.headers.get === 'function'
        ? resp.headers.get('content-type') || ''
        : '';
      const data = !contentType || contentType.includes('application/json')
        ? await resp.json()
        : { error: await resp.text() };

      if (!resp.ok || data.error) {
        showInlineError(data.error || 'Something went wrong. Please try again.');
      } else {
        renderResults(data);
      }
    } catch (err) {
      showInlineError('Network error. Please try again.');
    } finally {
      calcBtn.disabled = false;
      calcBtn.textContent = 'Calculate monthly repayment';
    }
  });

  function showInlineError(msg) {
    const errEl = document.getElementById('calc-error');
    if (errEl) {
      errEl.textContent = msg;
      errEl.hidden = false;
      errEl.style.display = 'block';
    }
  }

  function hideInlineError() {
    const errEl = document.getElementById('calc-error');
    if (errEl) {
      errEl.textContent = '';
      errEl.innerHTML = '';
      errEl.hidden = true;
      errEl.style.display = 'none';
    }
  }

  function renderResults(r) {
    hideInlineError();
    const hasPGL = r.pglMonthlyRepayment !== null && r.pglMonthlyRepayment !== undefined;
    const noUndergradLoan = Boolean(r.noUndergradLoan);
    const ugMonthly = parseFloat(r.monthlyRepayment);
    const pglMonthly = hasPGL ? parseFloat(r.pglMonthlyRepayment) : 0;
    const totalMonthly = ugMonthly + pglMonthly;
    const totalAnnual = totalMonthly * 12;
    const belowThreshold = ugMonthly === 0 && (!hasPGL || pglMonthly === 0);

    document.getElementById('res-monthly').textContent = helpers.fmt(totalMonthly);
    document.getElementById('res-annual').textContent = belowThreshold ? '£0' : helpers.fmtShort(totalAnnual) + '/yr';

    document.getElementById('res-threshold').textContent = '£' + parseFloat(r.thresholdGbp).toLocaleString('en-GB');
    document.getElementById('res-rate').textContent = parseFloat(r.localPerGbp).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const currencyCode = selectedCountry ? selectedCountry.currency : r.salaryCurrencySymbol;
    document.getElementById('res-rate-sub').textContent = currencyCode + ' per £1 GBP';
    document.getElementById('res-gbp').textContent = helpers.fmtShort(r.salaryGbp);

    const noRep = document.getElementById('no-rep-notice');
    noRep.classList.toggle('show', belowThreshold);
    if (belowThreshold) {
      document.getElementById('no-rep-sub').textContent =
        `Your ${helpers.fmtShort(r.salaryGbp)} GBP salary is below the £${parseFloat(r.thresholdGbp).toLocaleString('en-GB')} threshold.`;
    }

    const breakdown = document.getElementById('breakdown-grid');
    if (hasPGL) {
      breakdown.classList.add('show');
      document.getElementById('bd-ug').textContent = helpers.fmt(ugMonthly);
      document.getElementById('bd-ug-rate').textContent = noUndergradLoan
        ? 'No undergraduate loan'
        : (helpers.PLAN_LABELS[r.selectedPlan] || r.selectedPlan) + ' · 9%';
      document.getElementById('bd-pgl').textContent = helpers.fmt(pglMonthly);
      document.getElementById('bd-total').textContent = helpers.fmt(totalMonthly);
    } else {
      breakdown.classList.remove('show');
    }

    updateWriteoffNotice(r, hasPGL, noUndergradLoan);
    revealResultsCard();

    graph.resetAssumptions();
    graph.setResult(r);
    updateBalanceRows(r, hasPGL, noUndergradLoan);
    graph.render();
  }

  function updateWriteoffNotice(r, hasPGL, noUndergradLoan) {
    const writeoffEl = document.getElementById('writeoff-notice');
    const writeoffText = document.getElementById('writeoff-text');
    const wo = helpers.calcWriteOff(GRADUATION_DATE, noUndergradLoan ? 'planPg' : r.selectedPlan);
    if (wo && writeoffEl) {
      const planLabel = helpers.PLAN_LABELS[wo.plan] || wo.plan;
      const caveat = wo.plan === 'plan1' ? ' (or when you turn 65, whichever is sooner)' : '';
      const pglWriteOffYear = wo.firstRepayYear + 30;
      let text;
      if (noUndergradLoan) {
        text = `Your Postgraduate Loan will be written off in April ${wo.writeOffYear} — ${helpers.timeUntilApril(wo.writeOffYear)} from now.`;
      } else if (hasPGL && pglWriteOffYear === wo.writeOffYear) {
        text = `Your ${planLabel} and Postgraduate loans will both be written off in April ${wo.writeOffYear} — ${helpers.timeUntilApril(wo.writeOffYear)} from now${caveat}.`;
      } else if (hasPGL) {
        text = `Your ${planLabel} loan will be written off in April ${wo.writeOffYear} (${helpers.timeUntilApril(wo.writeOffYear)} from now${caveat}), and your Postgraduate Loan in April ${pglWriteOffYear} (${helpers.timeUntilApril(pglWriteOffYear)} from now).`;
      } else {
        text = `Your ${planLabel} loan will be written off in April ${wo.writeOffYear} — ${helpers.timeUntilApril(wo.writeOffYear)} from now${caveat}.`;
      }
      writeoffText.textContent = text;
      graph.setLastWriteoffText(text);
      writeoffEl.style.display = 'flex';
    } else if (writeoffEl) {
      graph.setLastWriteoffText(null);
      writeoffEl.style.display = 'none';
    }
  }

  function revealResultsCard() {
    const placeholder = document.getElementById('results-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    if (!resultsCard.classList.contains('visible')) {
      resultsCard.style.display = 'block';
      requestAnimationFrame(() => {
        resultsCard.classList.add('visible');
        if (window.innerWidth <= 860) {
          resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
    resultsCard.classList.remove('animate-in');
    void resultsCard.offsetWidth;
    resultsCard.classList.add('animate-in');
  }

  function updateBalanceRows(r, hasPGL, noUndergradLoan) {
    const pglBalanceRow = document.getElementById('pgl-balance-row');
    if (pglBalanceRow) pglBalanceRow.style.display = hasPGL ? '' : 'none';
    const ugRow = document.getElementById('ug-balance-row');
    if (ugRow) ugRow.style.display = noUndergradLoan ? 'none' : '';

    const balanceInput = document.getElementById('loan-balance-input');
    if (balanceInput && balanceInput.value === '' && r.loanValueGbp) {
      balanceInput.value = r.loanValueGbp;
    }
    const pglBalanceInput = document.getElementById('pgl-balance-input');
    if (pglBalanceInput && pglBalanceInput.value === '' && r.loanValuePglGbp) {
      pglBalanceInput.value = r.loanValuePglGbp;
    }
  }

  window.onThemeChange = function () { graph.render(); };
})();

if (window.adsbygoogle && document.querySelector('.adsbygoogle')) {
  window.adsbygoogle.push({});
}
