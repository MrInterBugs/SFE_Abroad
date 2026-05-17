(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./calculator-helpers'));
  } else {
    root.SFECalculatorGraph = factory(root.SFECalculatorHelpers);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (helpers) {
  const DEFAULT_RPI_RATE = 3.2;
  const DEFAULT_PAY_RISE = 2;

  function createRepaymentGraph({ document, window, graduationDate }) {
    let chartInstance = null;
    let chartJsPromise = null;
    let lastResult = null;
    let lastWriteoffText = null;

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

    function updatePlan2Note(rpi) {
      const note = document.getElementById('plan2-rate-note');
      if (!note) return;
      if (!lastResult || lastResult.selectedPlan !== 'plan2') {
        note.style.display = 'none';
        return;
      }
      const thresholds = helpers.plan2InterestThresholds(lastResult);
      const surcharge = helpers.calcPlan2Surcharge(parseFloat(lastResult.salaryGbp), thresholds);
      const effective = rpi + surcharge;
      let detail;
      if (!thresholds || surcharge === 0) {
        detail = thresholds
          ? `RPI only — income below £${Math.round(thresholds.lower).toLocaleString('en-GB')}`
          : 'RPI only';
      } else if (surcharge >= 3) {
        detail = `RPI + 3% — income above £${Math.round(thresholds.upper).toLocaleString('en-GB')}`;
      } else {
        detail = `RPI + ${surcharge.toFixed(1)}% income surcharge`;
      }
      note.textContent = `Plan 2 effective rate: ${effective.toFixed(1)}% (${detail})`;
      note.style.display = 'block';
    }

    function updatePglNote(rpi) {
      const note = document.getElementById('pgl-rate-note');
      if (!note) return;
      const primaryPgl = lastResult && (lastResult.noUndergradLoan || lastResult.effectivePlan === 'planPg');
      const secondaryPgl = lastResult && lastResult.pglMonthlyRepayment !== null && lastResult.pglMonthlyRepayment !== undefined;
      if (!primaryPgl && !secondaryPgl) {
        note.style.display = 'none';
        return;
      }
      const effective = rpi + 3;
      note.textContent = `Postgraduate Loan rate: ${effective.toFixed(1)}% (RPI ${rpi.toFixed(1)}% + 3% fixed)`;
      note.style.display = 'block';
    }

    function clear() {
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      const elInterest = document.getElementById('stat-interest');
      const elPaid = document.getElementById('stat-paid');
      if (elInterest) elInterest.textContent = '—';
      if (elPaid) elPaid.textContent = '—';
    }

    function updateSliderDisplays() {
      const rateSlider = document.getElementById('rate-slider');
      const rateDisplay = document.getElementById('rate-display');
      if (rateSlider && rateDisplay) {
        rateDisplay.textContent = parseFloat(rateSlider.value || DEFAULT_RPI_RATE).toFixed(1) + '%';
      }

      const payRiseSlider = document.getElementById('payrise-slider');
      const payRiseDisplay = document.getElementById('payrise-display');
      if (payRiseSlider && payRiseDisplay) {
        payRiseDisplay.textContent = parseFloat(payRiseSlider.value || DEFAULT_PAY_RISE).toFixed(1) + '%';
      }
    }

    function resetAssumptions() {
      const rateSlider = document.getElementById('rate-slider');
      if (rateSlider) rateSlider.value = String(DEFAULT_RPI_RATE);

      const payRiseSlider = document.getElementById('payrise-slider');
      if (payRiseSlider) payRiseSlider.value = String(DEFAULT_PAY_RISE);

      updateSliderDisplays();
    }

    async function render() {
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
      const rpi = isFinite(interestRateParsed) ? interestRateParsed : DEFAULT_RPI_RATE;
      const payRiseParsed = parseFloat(payRiseSlider && payRiseSlider.value);
      const payRise = isFinite(payRiseParsed) ? payRiseParsed : DEFAULT_PAY_RISE;
      const primaryPgl = Boolean(lastResult.noUndergradLoan || lastResult.effectivePlan === 'planPg');
      const plan2Surcharge = lastResult.selectedPlan === 'plan2'
        ? helpers.calcPlan2Surcharge(parseFloat(lastResult.salaryGbp), helpers.plan2InterestThresholds(lastResult))
        : 0;
      const interestRate = primaryPgl ? rpi + 3 : rpi + plan2Surcharge;
      updatePlan2Note(rpi);
      updatePglNote(rpi);

      panel.style.display = 'block';
      try {
        await loadChartJs();
      } catch (err) {
        panel.style.display = 'none';
        return;
      }

      const planLabel = primaryPgl ? 'Postgraduate Loan' : (helpers.PLAN_LABELS[lastResult.selectedPlan] || 'UG');
      const balanceLabel = document.querySelector('label[for="loan-balance-input"]');
      if (balanceLabel) balanceLabel.textContent = planLabel + ' loan balance';

      const hasPGL = lastResult.pglMonthlyRepayment !== null && lastResult.pglMonthlyRepayment !== undefined;
      const salaryGbp = parseFloat(lastResult.salaryGbp);
      const thresholdGbp = parseFloat(lastResult.thresholdGbp);
      const pglThresholdGbp = lastResult.pglThresholdGbp ? parseFloat(lastResult.pglThresholdGbp) : 0;

      const currentYear = new Date().getFullYear();
      const wo = helpers.calcWriteOff(graduationDate, primaryPgl ? 'planPg' : lastResult.selectedPlan);
      const writeOffCalYear = wo
        ? wo.writeOffYear
        : currentYear + (helpers.WRITE_OFF_YEARS[primaryPgl ? 'planPg' : lastResult.selectedPlan] || 30);
      const maxYears = Math.max(1, writeOffCalYear - currentYear);

      const writeoffEl = document.getElementById('writeoff-notice');

      const primaryBalance = primaryPgl ? pglBalance : ugBalance;
      if (primaryBalance <= 0 && (!hasPGL || primaryPgl || pglBalance <= 0)) {
        clear();
        if (writeoffEl && wo) writeoffEl.style.display = 'flex';
        return;
      }

      const pglRate = rpi + 3;
      const primaryRepaymentRate = primaryPgl ? 0.06 : 0.09;
      const ugResult = helpers.buildBalanceOverTime(primaryBalance, interestRate, maxYears, payRise, salaryGbp, thresholdGbp, primaryRepaymentRate, rpi);
      let pglResult = null;
      if (hasPGL && !primaryPgl && pglBalance > 0) {
        pglResult = helpers.buildBalanceOverTime(pglBalance, pglRate, maxYears, payRise, salaryGbp, pglThresholdGbp, 0.06, rpi);
      }

      const ugPaidOff = ugResult.paidOff && ugResult.payoffYear !== null;
      const pglPaidOff = !pglResult || (pglResult.paidOff && pglResult.payoffYear !== null);
      let displayYears = maxYears;
      if (ugPaidOff && pglPaidOff) {
        displayYears = Math.max(ugResult.payoffYear, pglResult ? pglResult.payoffYear : 0);
      }
      const labels = Array.from({ length: displayYears + 1 }, (_, i) => String(currentYear + i));

      const writeoffText = document.getElementById('writeoff-text');
      if (writeoffEl && writeoffText) {
        const ugPO = ugResult.paidOff && ugResult.payoffYear !== null;
        const pglPO = pglResult && pglResult.paidOff && pglResult.payoffYear !== null;

        if (ugPO || pglPO) {
          const ugPOYear = ugPO ? currentYear + ugResult.payoffYear : null;
          const pglPOYear = pglPO ? currentYear + pglResult.payoffYear : null;
          const pglWOYear = wo ? wo.firstRepayYear + 30 : null;
          let text;

          if (!pglResult) {
            text = `Based on your current balance, your ${planLabel}${primaryPgl ? '' : ' loan'} will be fully repaid by ${ugPOYear}.`;
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
          if (lastWriteoffText) {
            writeoffText.textContent = lastWriteoffText;
          } else {
            writeoffText.textContent = `Based on your current balance and repayment rate, your ${planLabel}${primaryPgl ? '' : ' loan'} will be written off by ${writeOffCalYear} (or sooner, depending on when you graduated) rather than fully repaid.`;
          }
          writeoffEl.style.display = 'flex';
        }
      }

      let combinedPaid = ugResult.totalPaid;
      let combinedInterest = ugResult.totalInterest;

      const isDark = document.documentElement && document.documentElement.dataset && document.documentElement.dataset.theme === 'dark';
      const datasets = [{
        label: primaryPgl ? planLabel : planLabel + ' Loan',
        data: ugResult.data.slice(0, displayYears + 1),
        borderColor: isDark ? '#4d9de0' : '#1d70b8',
        backgroundColor: isDark ? 'rgba(77,157,224,0.1)' : 'rgba(29,112,184,0.07)',
        fill: true, tension: 0.2, pointRadius: 0, borderWidth: 2,
      }];

      if (pglResult) {
        combinedPaid += pglResult.totalPaid;
        combinedInterest += pglResult.totalInterest;
        datasets.push({
          label: 'Postgraduate Loan',
          data: pglResult.data.slice(0, displayYears + 1),
          borderColor: isDark ? '#2db87a' : '#00703c',
          backgroundColor: isDark ? 'rgba(45,184,122,0.08)' : 'rgba(0,112,60,0.05)',
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
      chartInstance = new window.Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        plugins: [writeOffLinePlugin],
        options: {
          responsive: true,
          maintainAspectRatio: true,
          layout: { padding: { top: 18 } },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: datasets.length > 1, position: 'top', labels: { font: { family: 'DM Sans', size: 12 }, color: isDark ? '#9aa5b0' : undefined, boxWidth: 12, padding: 16 } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: £${Math.round(ctx.raw ?? 0).toLocaleString('en-GB')}` } },
          },
          scales: {
            x: { ticks: { font: { family: 'DM Sans', size: 11 }, color: isDark ? '#6b7786' : undefined, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' } },
            y: { min: 0, ticks: { font: { family: 'DM Sans', size: 11 }, color: isDark ? '#6b7786' : undefined, callback: v => '£' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v), maxTicksLimit: 6 }, grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' } },
          },
        },
      });
    }

    function initControls() {
      const rateSlider = document.getElementById('rate-slider');
      if (rateSlider) {
        rateSlider.addEventListener('input', () => {
          updateSliderDisplays();
          render();
        });
      }
      const payRiseSlider = document.getElementById('payrise-slider');
      if (payRiseSlider) {
        payRiseSlider.addEventListener('input', () => {
          updateSliderDisplays();
          render();
        });
      }
      ['loan-balance-input', 'pgl-balance-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', render);
      });
    }

    return {
      initControls,
      resetAssumptions,
      render,
      setResult(result) {
        lastResult = result;
      },
      setLastWriteoffText(text) {
        lastWriteoffText = text;
      },
    };
  }

  return { createRepaymentGraph };
});
