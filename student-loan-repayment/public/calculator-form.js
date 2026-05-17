(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SFECalculatorForm = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createCalculationForm({
    document,
    form,
    calcBtn,
    countryInput,
    getSelectedCountry,
    necessaryCookies,
    renderResults,
    showInlineError,
    hideInlineError,
  }) {
    function validateForm() {
      let valid = true;

      if (!getSelectedCountry()) {
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

      return valid;
    }

    async function csrfToken() {
      const csrfInput = document.getElementById('csrf-input');
      if (csrfInput.value) return csrfInput.value;

      const tokenResp = await fetch('/csrf-token', {
        headers: { 'Accept': 'application/json' },
      });

      if (!tokenResp.ok) {
        necessaryCookies.requireConsentThenRetry();
        return null;
      }

      const tokenData = await tokenResp.json();
      csrfInput.value = tokenData.csrfToken;
      return tokenData.csrfToken;
    }

    async function parseResponse(resp) {
      const contentType = resp.headers && typeof resp.headers.get === 'function'
        ? resp.headers.get('content-type') || ''
        : '';
      return !contentType || contentType.includes('application/json')
        ? resp.json()
        : { error: await resp.text() };
    }

    async function submitCalculation() {
      const token = await csrfToken();
      if (!token) return;

      const body = new URLSearchParams(new FormData(form));
      const resp = await fetch('/calculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'X-CSRF-Token': token,
        },
        body: body.toString(),
      });

      const data = await parseResponse(resp);
      if (!resp.ok || data.error) {
        showInlineError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      renderResults(data);
    }

    function init() {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!validateForm()) return;

        hideInlineError();
        calcBtn.disabled = true;
        calcBtn.textContent = 'Calculating…';

        try {
          await submitCalculation();
        } catch (err) {
          showInlineError('Network error. Please try again.');
        } finally {
          calcBtn.disabled = false;
          calcBtn.textContent = 'Calculate monthly repayment';
        }
      });
    }

    return { init, validateForm };
  }

  return { createCalculationForm };
});
