(function () {
  const appData = JSON.parse(document.getElementById('app-data').textContent);
  const COUNTRIES = appData.countries;
  const GRADUATION_DATE = appData.graduationDate || null;
  const PROFILE_LOAN_GBP = appData.loanValueGbp || null;
  const PROFILE_PGL_GBP = appData.loanValuePglGbp || null;
  const AVAILABLE_PLANS_BY_YEAR = appData.availablePlansByYear || {};

  const WRITE_OFF_YEARS = { plan1: 25, plan2: 30, plan4: 30, plan5: 40 };
  const PLAN2_LOWER = 29385;
  const PLAN2_UPPER = 52884;
  const FALLBACK_AVAILABLE_PLANS = ['plan1', 'plan2', 'plan4', 'plan5', 'planPg'];

  function queryAll(selector) {
    return typeof document.querySelectorAll === 'function' ? document.querySelectorAll(selector) : [];
  }

  function availablePlansForYear(year) {
    const configured = AVAILABLE_PLANS_BY_YEAR[year];
    return Array.isArray(configured) ? configured : FALLBACK_AVAILABLE_PLANS;
  }

  function calcPlan2Surcharge(salaryGbp) {
    if (salaryGbp <= PLAN2_LOWER) return 0;
    if (salaryGbp >= PLAN2_UPPER) return 3;
    return ((salaryGbp - PLAN2_LOWER) / (PLAN2_UPPER - PLAN2_LOWER)) * 3;
  }

  function updatePlan2Note(rpi) {
    const note = document.getElementById('plan2-rate-note');
    if (!note) return;
    if (!lastResult || lastResult.selectedPlan !== 'plan2') {
      note.style.display = 'none';
      return;
    }
    const surcharge = calcPlan2Surcharge(parseFloat(lastResult.salaryGbp));
    const effective = rpi + surcharge;
    let detail;
    if (surcharge === 0) {
      detail = `RPI only — income below £${PLAN2_LOWER.toLocaleString('en-GB')}`;
    } else if (surcharge >= 3) {
      detail = `RPI + 3% — income above £${PLAN2_UPPER.toLocaleString('en-GB')}`;
    } else {
      detail = `RPI + ${surcharge.toFixed(1)}% income surcharge`;
    }
    note.textContent = `Plan 2 effective rate: ${effective.toFixed(1)}% (${detail})`;
    note.style.display = 'block';
  }

  function updatePglNote(rpi) {
    const note = document.getElementById('pgl-rate-note');
    if (!note) return;
    if (!lastResult || lastResult.pglMonthlyRepayment === null || lastResult.pglMonthlyRepayment === undefined) {
      note.style.display = 'none';
      return;
    }
    const effective = rpi + 3;
    note.textContent = `Postgraduate Loan rate: ${effective.toFixed(1)}% (RPI ${rpi.toFixed(1)}% + 3% fixed)`;
    note.style.display = 'block';
  }

  function calcWriteOff(graduationDate, plan) {
    const years = WRITE_OFF_YEARS[plan];
    if (!years || !graduationDate) return null;
    const [gradYear, gradMonth] = graduationDate.split('-').map(Number);
    const firstRepayYear = gradMonth <= 3 ? gradYear : gradYear + 1;
    return { writeOffYear: firstRepayYear + years, firstRepayYear, years, plan };
  }

  function timeUntilApril(targetYear) {
    const now = new Date();
    const totalMonths = (targetYear - now.getFullYear()) * 12 + (4 - (now.getMonth() + 1));
    const clipped = Math.max(0, totalMonths);
    const yrs = Math.floor(clipped / 12);
    const mos = clipped % 12;
    if (yrs === 0) return `${mos} month${mos !== 1 ? 's' : ''}`;
    if (mos === 0) return `${yrs} year${yrs !== 1 ? 's' : ''}`;
    return `${yrs} year${yrs !== 1 ? 's' : ''} and ${mos} month${mos !== 1 ? 's' : ''}`;
  }

  // ─── STATE ────────────────────────────────────────────────────────────────
  let selectedCountry = null;
  let acHighlightIdx = -1;
  let retryAfterNecessaryCookieConsent = false;
  let cookiebotLoaded = false;
  let necessaryCookieFallbackTimer = null;

  // ─── ELEMENTS ─────────────────────────────────────────────────────────────
  const countryInput = document.getElementById('country-input');
  const acList = document.getElementById('ac-list');
  const currencyBadge = document.getElementById('currency-badge');
  const pglCheck = document.getElementById('pgl-check');
  const pglRow = document.getElementById('pgl-row');
  const pglDivider = document.getElementById('pgl-divider');
  const form = document.getElementById('calc-form');
  const resultsCard = document.getElementById('results-card');
  const calcBtn = document.getElementById('calc-btn');

  initNecessaryCookieBanner();
  syncPlanAvailability();

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

  queryAll('input[name="selectedYear"]').forEach((input) => {
    input.addEventListener('change', syncPlanAvailability);
  });

  function syncPlanAvailability() {
    const selectedYearInput = document.querySelector('input[name="selectedYear"]:checked');
    const selectedYear = selectedYearInput ? selectedYearInput.value : '';
    const availablePlans = availablePlansForYear(selectedYear);
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

    selectedVisiblePlan = document.querySelector('input[name="selectedPlan"]:checked');
    if (!selectedVisiblePlan || selectedVisiblePlan.disabled) {
      const firstAvailablePlan = document.querySelector('.plan-card[data-plan]:not([hidden]) input[name="selectedPlan"]');
      if (firstAvailablePlan) firstAvailablePlan.checked = true;
    }

    const pglAvailable = availableSet.has('planPg');
    pglRow.hidden = !pglAvailable;
    if (pglDivider) pglDivider.hidden = !pglAvailable;
    pglCheck.disabled = !pglAvailable;
    if (!pglAvailable) {
      pglCheck.checked = false;
      pglRow.classList.remove('checked');
    } else {
      pglRow.classList.toggle('checked', pglCheck.checked);
    }
  }

  // ─── FORMATTING ───────────────────────────────────────────────────────────
  function fmt(n) {
    const val = parseFloat(n);
    if (val === 0) return '£0.00';
    return '£' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtShort(n) {
    return '£' + Math.round(parseFloat(n)).toLocaleString('en-GB');
  }

  // ─── GRAPH ────────────────────────────────────────────────────────────────
  let chartInstance = null;
  let lastResult = null;
  let lastWriteoffText = null;
  let chartJsPromise = null;

  function loadChartJs() {
    if (window.Chart) return Promise.resolve();
    if (chartJsPromise) return chartJsPromise;

    chartJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/chart.js/chart.umd.min.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return chartJsPromise;
  }

  function buildBalanceOverTime(startBalance, annualRatePct, maxYears, payRisePct, initialSalaryGbp, thresholdGbp, repaymentRate, thresholdRisePct = 0) {
    const monthlyRate = annualRatePct / 100 / 12;
    let balance = startBalance;
    const data = [parseFloat(startBalance.toFixed(2))];
    let totalPaid = 0;
    let paidOff = false;
    let payoffYear = null;
    for (let yr = 1; yr <= maxYears; yr++) {
      if (!paidOff) {
        const salary = initialSalaryGbp * Math.pow(1 + payRisePct / 100, yr - 1);
        const effectiveThreshold = thresholdGbp * Math.pow(1 + thresholdRisePct / 100, yr - 1);
        const monthlyPayment = Math.max(0, (salary - effectiveThreshold) * repaymentRate / 12);
        for (let m = 0; m < 12; m++) {
          const interest = balance * monthlyRate;
          const newBalance = Math.max(0, balance + interest - monthlyPayment);
          totalPaid += balance + interest - newBalance;
          balance = newBalance;
          if (balance === 0 && !paidOff) { paidOff = true; payoffYear = yr; }
        }
        balance = parseFloat(balance.toFixed(2));
      }
      data.push(paidOff ? 0 : balance);
    }
    const finalBalance = paidOff ? 0 : balance;
    const totalInterest = Math.max(0, totalPaid + finalBalance - startBalance);
    return { data, totalPaid: Math.round(totalPaid), totalInterest: Math.round(totalInterest), paidOff, payoffYear };
  }

  async function renderRepaymentGraph() {
    if (!lastResult) return;
    const panel = document.getElementById('repayment-graph-panel');
    if (!panel) return;

    const balanceInput = document.getElementById('loan-balance-input');
    const pglBalanceInput = document.getElementById('pgl-balance-input');
    const rateSlider = document.getElementById('rate-slider');
    const payRiseSlider = document.getElementById('payrise-slider');

    const ugBalance = parseFloat(balanceInput && balanceInput.value) || 0;
    const pglBalance = pglBalanceInput ? (parseFloat(pglBalanceInput.value) || 0) : 0;
    const interestRateParsed = parseFloat(rateSlider && rateSlider.value);
    const rpi = isFinite(interestRateParsed) ? interestRateParsed : 3.2;
    const payRiseParsed = parseFloat(payRiseSlider && payRiseSlider.value);
    const payRise = isFinite(payRiseParsed) ? payRiseParsed : 2;
    const plan2Surcharge = lastResult.selectedPlan === 'plan2'
      ? calcPlan2Surcharge(parseFloat(lastResult.salaryGbp))
      : 0;
    const interestRate = rpi + plan2Surcharge;
    updatePlan2Note(rpi);
    updatePglNote(rpi);

    panel.style.display = 'block';
    try {
      await loadChartJs();
    } catch (err) {
      panel.style.display = 'none';
      return;
    }

    const planLabels = { plan1: 'Plan 1', plan2: 'Plan 2', plan4: 'Plan 4', plan5: 'Plan 5' };
    const planLabel = planLabels[lastResult.selectedPlan] || 'UG';
    const balanceLabel = document.querySelector('label[for="loan-balance-input"]');
    if (balanceLabel) balanceLabel.textContent = planLabel + ' loan balance';

    const hasPGL = lastResult.pglMonthlyRepayment !== null && lastResult.pglMonthlyRepayment !== undefined;
    const salaryGbp = parseFloat(lastResult.salaryGbp);
    const thresholdGbp = parseFloat(lastResult.thresholdGbp);
    const pglThresholdGbp = lastResult.pglThresholdGbp ? parseFloat(lastResult.pglThresholdGbp) : 0;

    const currentYear = new Date().getFullYear();
    const wo = calcWriteOff(GRADUATION_DATE, lastResult.selectedPlan);
    const writeOffCalYear = wo
      ? wo.writeOffYear
      : currentYear + (WRITE_OFF_YEARS[lastResult.selectedPlan] || 30);
    const maxYears = Math.max(1, writeOffCalYear - currentYear);

    const writeoffEl = document.getElementById('writeoff-notice');

    if (ugBalance <= 0 && (!hasPGL || pglBalance <= 0)) {
      if (writeoffEl && wo) writeoffEl.style.display = 'flex';
      return;
    }

    const pglRate = rpi + 3;
    const ugResult = buildBalanceOverTime(ugBalance, interestRate, maxYears, payRise, salaryGbp, thresholdGbp, 0.09, rpi);
    let pglResult = null;
    if (hasPGL && pglBalance > 0) {
      pglResult = buildBalanceOverTime(pglBalance, pglRate, maxYears, payRise, salaryGbp, pglThresholdGbp, 0.06, rpi);
    }

    // Trim chart to payoff year if every displayed loan is paid off before write-off
    const ugPaidOff = ugResult.paidOff && ugResult.payoffYear !== null;
    const pglPaidOff = !pglResult || (pglResult.paidOff && pglResult.payoffYear !== null);
    let displayYears = maxYears;
    if (ugPaidOff && pglPaidOff) {
      displayYears = Math.max(ugResult.payoffYear, pglResult ? pglResult.payoffYear : 0);
    }
    const labels = Array.from({ length: displayYears + 1 }, (_, i) => String(currentYear + i));

    // Update write-off notice
    const writeoffText = document.getElementById('writeoff-text');
    if (writeoffEl && writeoffText) {
      const ugPO = ugResult.paidOff && ugResult.payoffYear !== null;
      const pglPO = pglResult && pglResult.paidOff && pglResult.payoffYear !== null;

      if (ugPO || pglPO) {
        const ugPOYear  = ugPO  ? currentYear + ugResult.payoffYear  : null;
        const pglPOYear = pglPO ? currentYear + pglResult.payoffYear : null;
        const pglWOYear = wo ? wo.firstRepayYear + 30 : null;
        let text;

        if (!pglResult) {
          text = `Based on your current balance, your ${planLabel} loan will be fully repaid by ${ugPOYear}.`;
        } else if (ugPO && pglPO) {
          text = ugPOYear === pglPOYear
            ? `Based on your current balance, your ${planLabel} and Postgraduate loans will both be fully repaid by ${ugPOYear}.`
            : `Based on your current balance, your ${planLabel} loan will be fully repaid by ${ugPOYear} and your Postgraduate Loan by ${pglPOYear}.`;
        } else if (ugPO) {
          const pglWO = pglWOYear ? ` Your Postgraduate Loan will be written off in April ${pglWOYear}.` : '';
          text = `Based on your current balance, your ${planLabel} loan will be fully repaid by ${ugPOYear}.${pglWO}`;
        } else {
          const ugWO = wo ? `Your ${planLabel} loan will be written off in April ${wo.writeOffYear}. ` : '';
          text = `${ugWO}Based on your current balance, your Postgraduate Loan will be fully repaid by ${pglPOYear}.`;
        }

        writeoffText.textContent = text;
        writeoffEl.style.display = 'flex';
      } else {
        // Neither loan paid off — loan(s) will be written off
        if (lastWriteoffText) {
          writeoffText.textContent = lastWriteoffText;
        } else {
          // No graduation date (not signed in): use estimated write-off year
          writeoffText.textContent = `Based on your current balance and repayment rate, your ${planLabel} loan will be written off by ${writeOffCalYear} (or sooner, depending on when you graduated) rather than fully repaid.`;
        }
        writeoffEl.style.display = 'flex';
      }
    }

    let combinedPaid = ugResult.totalPaid;
    let combinedInterest = ugResult.totalInterest;

    const datasets = [{
      label: planLabel + ' Loan',
      data: ugResult.data.slice(0, displayYears + 1),
      borderColor: '#1d70b8',
      backgroundColor: 'rgba(29,112,184,0.07)',
      fill: true, tension: 0.2, pointRadius: 0, borderWidth: 2,
    }];

    if (pglResult) {
      combinedPaid += pglResult.totalPaid;
      combinedInterest += pglResult.totalInterest;
      datasets.push({
        label: 'Postgraduate Loan',
        data: pglResult.data.slice(0, displayYears + 1),
        borderColor: '#00703c',
        backgroundColor: 'rgba(0,112,60,0.05)',
        fill: true, tension: 0.2, pointRadius: 0, borderWidth: 2, spanGaps: false,
      });
    }

    const fmtStat = v => '£' + v.toLocaleString('en-GB');
    const elInterest = document.getElementById('stat-interest');
    const elPaid = document.getElementById('stat-paid');
    if (elInterest) elInterest.textContent = fmtStat(combinedInterest);
    if (elPaid) elPaid.textContent = fmtStat(combinedPaid);

    const writeOffLinePlugin = {
      id: 'writeOffLine',
      afterDraw(chart) {
        const wLabel = String(writeOffCalYear);
        const wIdx = labels.indexOf(wLabel);
        if (wIdx < 0) return;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const x = xScale.getPixelForValue(wLabel);
        const c = chart.ctx;
        c.save();
        c.beginPath();
        c.setLineDash([5, 4]);
        c.strokeStyle = 'rgba(212,53,28,0.55)';
        c.lineWidth = 1.5;
        c.moveTo(x, yScale.top);
        c.lineTo(x, yScale.bottom);
        c.stroke();
        c.font = '10px DM Sans, sans-serif';
        c.fillStyle = '#d4351c';
        c.textAlign = x > chart.width / 2 ? 'right' : 'left';
        c.fillText('Written off', x > chart.width / 2 ? x - 4 : x + 4, yScale.top - 6);
        c.restore();
      }
    };

    const ctx = document.getElementById('repayment-chart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      plugins: [writeOffLinePlugin],
      options: {
        responsive: true,
        maintainAspectRatio: true,
        layout: { padding: { top: 18 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: datasets.length > 1, position: 'top', labels: { font: { family: 'DM Sans', size: 12 }, boxWidth: 12, padding: 16 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: £${Math.round(ctx.raw ?? 0).toLocaleString('en-GB')}` } },
        },
        scales: {
          x: { ticks: { font: { family: 'DM Sans', size: 11 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: 'rgba(0,0,0,0.04)' } },
          y: { min: 0, ticks: { font: { family: 'DM Sans', size: 11 }, callback: v => '£' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v), maxTicksLimit: 6 }, grid: { color: 'rgba(0,0,0,0.04)' } },
        },
      },
    });
  }

  // Wire up graph controls once
  (function setupGraphControls() {
    const rateSlider = document.getElementById('rate-slider');
    const rateDisplay = document.getElementById('rate-display');
    if (rateSlider) {
      rateSlider.addEventListener('input', () => {
        rateDisplay.textContent = parseFloat(rateSlider.value).toFixed(1) + '%';
        renderRepaymentGraph();
      });
    }
    const payRiseSlider = document.getElementById('payrise-slider');
    const payRiseDisplay = document.getElementById('payrise-display');
    if (payRiseSlider) {
      payRiseSlider.addEventListener('input', () => {
        payRiseDisplay.textContent = parseFloat(payRiseSlider.value).toFixed(1) + '%';
        renderRepaymentGraph();
      });
    }
    ['loan-balance-input', 'pgl-balance-input'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', renderRepaymentGraph);
    });
  })();

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
          retryAfterNecessaryCookieConsent = true;
          showNecessaryCookieBanner();
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

  function hasNecessaryCookieConsent() {
    try {
      return decodeURIComponent(document.cookie || '').includes('CookieConsent=necessary:true');
    } catch (_err) {
      return false;
    }
  }

  function setNecessaryCookieConsent() {
    const maxAge = 365 * 24 * 60 * 60;
    const secure = window.location && window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `CookieConsent=necessary%3Atrue; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  }

  function initNecessaryCookieBanner() {
    document.addEventListener('CookiebotOnLoad', () => {
      cookiebotLoaded = true;
      scheduleNecessaryCookieFallbackCheck(1500);
    });

    document.addEventListener('CookiebotOnAccept', () => {
      if (necessaryCookieFallbackTimer) window.clearTimeout(necessaryCookieFallbackTimer);
    });

    document.addEventListener('CookiebotOnDecline', () => {
      if (necessaryCookieFallbackTimer) window.clearTimeout(necessaryCookieFallbackTimer);
    });

    scheduleNecessaryCookieFallbackCheck(1200);
  }

  function scheduleNecessaryCookieFallbackCheck(delay) {
    if (necessaryCookieFallbackTimer) window.clearTimeout(necessaryCookieFallbackTimer);
    necessaryCookieFallbackTimer = window.setTimeout(() => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      if (!hasNecessaryCookieConsent() && !hasCookiebotUi()) {
        showNecessaryCookieBanner();
      }
    }, delay);
  }

  function hasCookiebotUi() {
    const selectors = [
      '#CybotCookiebotDialog',
      '#CookiebotWidget',
      '#CookiebotWidgetUnderlay',
      '.CybotCookiebotDialog'
    ];
    return selectors.some((selector) => {
      const element = document.querySelector(selector);
      if (!element || element.hidden) return false;
      if (typeof window.getComputedStyle !== 'function') return true;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });
  }

  function showNecessaryCookieBanner() {
    if (hasNecessaryCookieConsent() || document.getElementById('necessary-cookie-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'necessary-cookie-banner';
    banner.className = 'necessary-cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Necessary cookies');

    const text = document.createElement('p');
    text.textContent = 'This calculator uses necessary cookies for security and to run calculations. Cookiebot appears to be blocked, so optional cookie choices are unavailable here.';

    const actions = document.createElement('div');
    actions.className = 'necessary-cookie-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'necessary-cookie-accept';
    acceptBtn.textContent = 'Use calculator';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'necessary-cookie-close';
    closeBtn.setAttribute('aria-label', 'Close necessary cookie message');
    closeBtn.textContent = 'Close';

    acceptBtn.addEventListener('click', () => {
      setNecessaryCookieConsent();
      banner.remove();
      hideInlineError();

      if (retryAfterNecessaryCookieConsent) {
        retryAfterNecessaryCookieConsent = false;
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      }
    });
    closeBtn.addEventListener('click', () => banner.remove());

    actions.appendChild(acceptBtn);
    actions.appendChild(closeBtn);
    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);
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

  // ─── RESULTS ──────────────────────────────────────────────────────────────
  function renderResults(r) {
    hideInlineError();
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

    // Write-off notice
    const writeoffEl = document.getElementById('writeoff-notice');
    const writeoffText = document.getElementById('writeoff-text');
    const wo = calcWriteOff(GRADUATION_DATE, r.selectedPlan);
    if (wo && writeoffEl) {
      const planLabels = { plan1: 'Plan 1', plan2: 'Plan 2', plan4: 'Plan 4', plan5: 'Plan 5' };
      const planLabel = planLabels[wo.plan] || wo.plan;
      const caveat = wo.plan === 'plan1' ? ' (or when you turn 65, whichever is sooner)' : '';
      const pglWriteOffYear = wo.firstRepayYear + 30;
      let text;
      if (hasPGL && pglWriteOffYear === wo.writeOffYear) {
        text = `Your ${planLabel} and Postgraduate loans will both be written off in April ${wo.writeOffYear} — ${timeUntilApril(wo.writeOffYear)} from now${caveat}.`;
      } else if (hasPGL) {
        text = `Your ${planLabel} loan will be written off in April ${wo.writeOffYear} (${timeUntilApril(wo.writeOffYear)} from now${caveat}), and your Postgraduate Loan in April ${pglWriteOffYear} (${timeUntilApril(pglWriteOffYear)} from now).`;
      } else {
        text = `Your ${planLabel} loan will be written off in April ${wo.writeOffYear} — ${timeUntilApril(wo.writeOffYear)} from now${caveat}.`;
      }
      writeoffText.textContent = text;
      lastWriteoffText = text;
      writeoffEl.style.display = 'flex';
    } else if (writeoffEl) {
      writeoffEl.style.display = 'none';
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

    // Graph
    lastResult = r;

    // Show/hide PGL balance row based on whether PGL is active
    const pglRow = document.getElementById('pgl-balance-row');
    if (pglRow) pglRow.style.display = hasPGL ? '' : 'none';

    // Pre-populate balance inputs from profile on first use
    const balanceInput = document.getElementById('loan-balance-input');
    if (balanceInput && balanceInput.value === '' && r.loanValueGbp) {
      balanceInput.value = r.loanValueGbp;
    }
    const pglBalanceInput = document.getElementById('pgl-balance-input');
    if (pglBalanceInput && pglBalanceInput.value === '' && r.loanValuePglGbp) {
      pglBalanceInput.value = r.loanValuePglGbp;
    }

    renderRepaymentGraph();
  }
})();

if (window.adsbygoogle && document.querySelector('.adsbygoogle')) {
  window.adsbygoogle.push({});
}
