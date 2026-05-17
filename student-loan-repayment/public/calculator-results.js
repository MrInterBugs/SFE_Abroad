(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./calculator-helpers'));
  } else {
    root.SFECalculatorResults = factory(root.SFECalculatorHelpers);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (helpers) {
  function createResultsRenderer({
    document,
    window,
    graph,
    graduationDate,
    resultsCard,
    getSelectedCountry,
    hideInlineError,
  }) {
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

    function updateBalanceRows(result, hasPGL, noUndergradLoan) {
      const pglBalanceRow = document.getElementById('pgl-balance-row');
      if (pglBalanceRow) pglBalanceRow.style.display = hasPGL ? 'flex' : 'none';
      const ugRow = document.getElementById('ug-balance-row');
      if (ugRow) ugRow.style.display = noUndergradLoan ? 'none' : '';

      const balanceInput = document.getElementById('loan-balance-input');
      if (balanceInput && balanceInput.value === '' && result.loanValueGbp) {
        balanceInput.value = result.loanValueGbp;
      }
      const pglBalanceInput = document.getElementById('pgl-balance-input');
      if (pglBalanceInput && pglBalanceInput.value === '' && result.loanValuePglGbp) {
        pglBalanceInput.value = result.loanValuePglGbp;
      }
    }

    function updateWriteoffNotice(result, hasPGL, noUndergradLoan) {
      const writeoffEl = document.getElementById('writeoff-notice');
      const writeoffText = document.getElementById('writeoff-text');
      const writeoff = helpers.calcWriteOff(graduationDate, noUndergradLoan ? 'planPg' : result.selectedPlan);

      if (writeoff && writeoffEl) {
        const planLabel = helpers.PLAN_LABELS[writeoff.plan] || writeoff.plan;
        const caveat = writeoff.plan === 'plan1' ? ' (or when you turn 65, whichever is sooner)' : '';
        const pglWriteOffYear = writeoff.firstRepayYear + 30;
        let text;

        if (noUndergradLoan) {
          text = `Your Postgraduate Loan will be written off in April ${writeoff.writeOffYear} — ${helpers.timeUntilApril(writeoff.writeOffYear)} from now.`;
        } else if (hasPGL && pglWriteOffYear === writeoff.writeOffYear) {
          text = `Your ${planLabel} and Postgraduate loans will both be written off in April ${writeoff.writeOffYear} — ${helpers.timeUntilApril(writeoff.writeOffYear)} from now${caveat}.`;
        } else if (hasPGL) {
          text = `Your ${planLabel} loan will be written off in April ${writeoff.writeOffYear} (${helpers.timeUntilApril(writeoff.writeOffYear)} from now${caveat}), and your Postgraduate Loan in April ${pglWriteOffYear} (${helpers.timeUntilApril(pglWriteOffYear)} from now).`;
        } else {
          text = `Your ${planLabel} loan will be written off in April ${writeoff.writeOffYear} — ${helpers.timeUntilApril(writeoff.writeOffYear)} from now${caveat}.`;
        }

        writeoffText.textContent = text;
        graph.setLastWriteoffText(text);
        writeoffEl.style.display = 'flex';
      } else if (writeoffEl) {
        graph.setLastWriteoffText(null);
        writeoffEl.style.display = 'none';
      }
    }

    function renderResults(result) {
      hideInlineError();
      const hasPGL = result.pglMonthlyRepayment !== null && result.pglMonthlyRepayment !== undefined;
      const noUndergradLoan = Boolean(result.noUndergradLoan);
      const ugMonthly = parseFloat(result.monthlyRepayment);
      const pglMonthly = hasPGL ? parseFloat(result.pglMonthlyRepayment) : 0;
      const totalMonthly = ugMonthly + pglMonthly;
      const totalAnnual = totalMonthly * 12;
      const belowThreshold = ugMonthly === 0 && (!hasPGL || pglMonthly === 0);

      document.getElementById('res-monthly').textContent = helpers.fmt(totalMonthly);
      document.getElementById('res-annual').textContent = belowThreshold ? '£0' : helpers.fmtShort(totalAnnual) + '/yr';
      document.getElementById('res-threshold').textContent = '£' + parseFloat(result.thresholdGbp).toLocaleString('en-GB');
      document.getElementById('res-rate').textContent = parseFloat(result.localPerGbp).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

      const selectedCountry = getSelectedCountry();
      const currencyCode = selectedCountry ? selectedCountry.currency : result.salaryCurrencySymbol;
      document.getElementById('res-rate-sub').textContent = currencyCode + ' per £1 GBP';
      document.getElementById('res-gbp').textContent = helpers.fmtShort(result.salaryGbp);

      const noRep = document.getElementById('no-rep-notice');
      noRep.classList.toggle('show', belowThreshold);
      if (belowThreshold) {
        document.getElementById('no-rep-sub').textContent =
          `Your ${helpers.fmtShort(result.salaryGbp)} GBP salary is below the £${parseFloat(result.thresholdGbp).toLocaleString('en-GB')} threshold.`;
      }

      const breakdown = document.getElementById('breakdown-grid');
      if (hasPGL) {
        breakdown.classList.add('show');
        document.getElementById('bd-ug').textContent = helpers.fmt(ugMonthly);
        document.getElementById('bd-ug-rate').textContent = noUndergradLoan
          ? 'No undergraduate loan'
          : (helpers.PLAN_LABELS[result.selectedPlan] || result.selectedPlan) + ' · 9%';
        document.getElementById('bd-pgl').textContent = helpers.fmt(pglMonthly);
        document.getElementById('bd-total').textContent = helpers.fmt(totalMonthly);
      } else {
        breakdown.classList.remove('show');
      }

      updateWriteoffNotice(result, hasPGL, noUndergradLoan);
      revealResultsCard();

      graph.resetAssumptions();
      graph.setResult(result);
      updateBalanceRows(result, hasPGL, noUndergradLoan);
      graph.render();
    }

    return { renderResults };
  }

  return { createResultsRenderer };
});
