(function () {
  const appData = JSON.parse(document.getElementById('app-data').textContent);
  const COUNTRIES = appData.countries;

  // ─── STATE ────────────────────────────────────────────────────────────────
  let selectedCountry = null;
  let acHighlightIdx = -1;

  // ─── ELEMENTS ─────────────────────────────────────────────────────────────
  const countryInput = document.getElementById('country-input');
  const acList = document.getElementById('ac-list');
  const currencyBadge = document.getElementById('currency-badge');
  const pglCheck = document.getElementById('pgl-check');
  const pglRow = document.getElementById('pgl-row');
  const form = document.getElementById('calc-form');
  const resultsCard = document.getElementById('results-card');
  const calcBtn = document.getElementById('calc-btn');

  // Pre-select country from server-populated value (saved cookie)
  const cookieCountry = countryInput.value.trim();
  if (cookieCountry) {
    const match = COUNTRIES.find(c => c.name === cookieCountry);
    if (match) selectCountry(match);
  }

  // ─── AUTOCOMPLETE ─────────────────────────────────────────────────────────
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
    items.forEach((c, i) => {
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

  // ─── PGL CHECKBOX ─────────────────────────────────────────────────────────
  pglCheck.addEventListener('change', () => {
    pglRow.classList.toggle('checked', pglCheck.checked);
  });

  // ─── FORMATTING ───────────────────────────────────────────────────────────
  function fmt(n) {
    const val = parseFloat(n);
    if (val === 0) return '£0.00';
    return '£' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtShort(n) {
    return '£' + Math.round(parseFloat(n)).toLocaleString('en-GB');
  }

  // ─── FORM SUBMIT ──────────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let valid = true;

    if (!selectedCountry) {
      document.getElementById('country-error').classList.add('show');
      countryInput.classList.add('error');
      valid = false;
    }

    const salaryInput = document.getElementById('salary-input');
    const salary = parseFloat(salaryInput.value);
    if (!salary || salary <= 0) {
      document.getElementById('salary-error').classList.add('show');
      salaryInput.classList.add('error');
      valid = false;
    } else {
      document.getElementById('salary-error').classList.remove('show');
      salaryInput.classList.remove('error');
    }

    if (!valid) return;

    calcBtn.disabled = true;
    calcBtn.textContent = 'Calculating…';

    const csrfToken = document.getElementById('csrf-input').value;
    const body = new URLSearchParams(new FormData(form));

    try {
      const resp = await fetch('/calculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: body.toString(),
      });

      const data = await resp.json();

      if (data.error) {
        showInlineError(data.error);
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
      errEl.style.display = 'block';
    }
  }

  // ─── RESULTS ──────────────────────────────────────────────────────────────
  function renderResults(r) {
    const hasPGL = r.pglMonthlyRepayment !== null && r.pglMonthlyRepayment !== undefined;
    const ugMonthly = parseFloat(r.monthlyRepayment);
    const pglMonthly = hasPGL ? parseFloat(r.pglMonthlyRepayment) : 0;
    const totalMonthly = ugMonthly + pglMonthly;
    const totalAnnual = totalMonthly * 12;
    const belowThreshold = ugMonthly === 0 && (!hasPGL || pglMonthly === 0);

    document.getElementById('res-monthly').textContent = fmt(totalMonthly);
    document.getElementById('res-annual').textContent = belowThreshold ? '£0' : fmtShort(totalAnnual) + '/yr';

    document.getElementById('res-threshold').textContent = '£' + parseFloat(r.thresholdGbp).toLocaleString('en-GB');
    document.getElementById('res-rate').textContent = parseFloat(r.localPerGbp).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const currencyCode = selectedCountry ? selectedCountry.currency : r.salaryCurrencySymbol;
    document.getElementById('res-rate-sub').textContent = currencyCode + ' per £1 GBP';
    document.getElementById('res-gbp').textContent = fmtShort(r.salaryGbp);

    // No repayment notice
    const noRep = document.getElementById('no-rep-notice');
    noRep.classList.toggle('show', belowThreshold);
    if (belowThreshold) {
      document.getElementById('no-rep-sub').textContent =
        `Your ${fmtShort(r.salaryGbp)} GBP salary is below the £${parseFloat(r.thresholdGbp).toLocaleString('en-GB')} threshold.`;
    }

    // PGL breakdown
    const breakdown = document.getElementById('breakdown-grid');
    if (hasPGL) {
      breakdown.classList.add('show');
      document.getElementById('bd-ug').textContent = fmt(ugMonthly);
      const planLabels = { plan1: 'Plan 1', plan2: 'Plan 2', plan4: 'Plan 4', plan5: 'Plan 5' };
      document.getElementById('bd-ug-rate').textContent = (planLabels[r.selectedPlan] || r.selectedPlan) + ' · 9%';
      document.getElementById('bd-pgl').textContent = fmt(pglMonthly);
      document.getElementById('bd-total').textContent = fmt(totalMonthly);
    } else {
      breakdown.classList.remove('show');
    }

    // Hide placeholder, show results card
    const placeholder = document.getElementById('results-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    if (!resultsCard.classList.contains('visible')) {
      resultsCard.style.display = 'block';
      requestAnimationFrame(() => {
        resultsCard.classList.add('visible');
        // On mobile (single column), scroll to results; on desktop it's already visible
        if (window.innerWidth <= 860) {
          resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
    resultsCard.classList.remove('animate-in');
    void resultsCard.offsetWidth;
    resultsCard.classList.add('animate-in');
  }
})();

(window.adsbygoogle = window.adsbygoogle || []).push({});
