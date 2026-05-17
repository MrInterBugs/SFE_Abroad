(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./calculator-helpers'));
  } else {
    root.SFECalculatorPlanControls = factory(root.SFECalculatorHelpers);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (helpers) {
  function queryAll(document, selector) {
    return typeof document.querySelectorAll === 'function' ? document.querySelectorAll(selector) : [];
  }

  function firstAvailablePlanInput(document) {
    return document.querySelector('.plan-card[data-plan]:not([hidden]) input[name="selectedPlan"]');
  }

  function createPlanControls({
    document,
    availablePlansByYear,
    pglCheck,
    pglRow,
    noUgCheck,
    noUgRow,
    pglDivider,
  }) {
    function syncPlanAvailability() {
      const selectedYearInput = document.querySelector('input[name="selectedYear"]:checked');
      const selectedYear = selectedYearInput ? selectedYearInput.value : '';
      const availablePlans = helpers.availablePlansForYear(availablePlansByYear, selectedYear);
      const availableSet = new Set(availablePlans);

      queryAll(document, '.plan-card[data-plan]').forEach((card) => {
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
        queryAll(document, 'input[name="selectedPlan"]').forEach((input) => { input.checked = false; });
        return;
      }

      const selectedVisiblePlan = document.querySelector('input[name="selectedPlan"]:checked');
      if (!selectedVisiblePlan || selectedVisiblePlan.disabled) {
        const firstPlan = firstAvailablePlanInput(document);
        if (firstPlan) firstPlan.checked = true;
      }
    }

    function init() {
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
            queryAll(document, 'input[name="selectedPlan"]').forEach((input) => { input.checked = false; });
            pglCheck.checked = true;
            pglRow.classList.add('checked');
          } else if (!document.querySelector('input[name="selectedPlan"]:checked')) {
            const firstPlan = firstAvailablePlanInput(document);
            if (firstPlan) firstPlan.checked = true;
          }
        });
      }

      queryAll(document, 'input[name="selectedYear"]').forEach((input) => {
        input.addEventListener('change', syncPlanAvailability);
      });

      queryAll(document, 'input[name="selectedPlan"]').forEach((input) => {
        input.addEventListener('change', () => {
          if (input.checked && noUgCheck) {
            noUgCheck.checked = false;
            noUgRow.classList.remove('checked');
          }
          syncPlanAvailability();
        });
      });

      syncPlanAvailability();
    }

    return { init, syncPlanAvailability };
  }

  return { createPlanControls };
});
