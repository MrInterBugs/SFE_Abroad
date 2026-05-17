(function () {
  const consentModule = typeof require === 'function'
    ? require('./calculator-consent')
    : window.SFECalculatorConsent;
  const graphModule = typeof require === 'function'
    ? require('./calculator-graph')
    : window.SFECalculatorGraph;
  const autocompleteModule = typeof require === 'function'
    ? require('./calculator-autocomplete')
    : window.SFECalculatorAutocomplete;
  const planControlsModule = typeof require === 'function'
    ? require('./calculator-plan-controls')
    : window.SFECalculatorPlanControls;
  const resultsModule = typeof require === 'function'
    ? require('./calculator-results')
    : window.SFECalculatorResults;
  const formModule = typeof require === 'function'
    ? require('./calculator-form')
    : window.SFECalculatorForm;

  const appData = JSON.parse(document.getElementById('app-data').textContent);
  const elements = {
    countryInput: document.getElementById('country-input'),
    acList: document.getElementById('ac-list'),
    currencyBadge: document.getElementById('currency-badge'),
    pglCheck: document.getElementById('pgl-check'),
    pglRow: document.getElementById('pgl-row'),
    noUgCheck: document.getElementById('no-ug-check'),
    noUgRow: document.getElementById('no-ug-row'),
    pglDivider: document.getElementById('pgl-divider'),
    form: document.getElementById('calc-form'),
    resultsCard: document.getElementById('results-card'),
    calcBtn: document.getElementById('calc-btn'),
  };

  const graph = graphModule.createRepaymentGraph({
    document,
    window,
    graduationDate: appData.graduationDate || null,
  });

  const necessaryCookies = consentModule.createNecessaryCookieController({
    document,
    window,
    form: elements.form,
    hideInlineError,
  });

  const countries = autocompleteModule.createCountryAutocomplete({
    document,
    countries: appData.countries,
    countryInput: elements.countryInput,
    acList: elements.acList,
    currencyBadge: elements.currencyBadge,
  });

  const plans = planControlsModule.createPlanControls({
    document,
    availablePlansByYear: appData.availablePlansByYear || {},
    pglCheck: elements.pglCheck,
    pglRow: elements.pglRow,
    noUgCheck: elements.noUgCheck,
    noUgRow: elements.noUgRow,
    pglDivider: elements.pglDivider,
  });

  const results = resultsModule.createResultsRenderer({
    document,
    window,
    graph,
    graduationDate: appData.graduationDate || null,
    resultsCard: elements.resultsCard,
    getSelectedCountry: countries.getSelectedCountry,
    hideInlineError,
  });

  const calculationForm = formModule.createCalculationForm({
    document,
    form: elements.form,
    calcBtn: elements.calcBtn,
    countryInput: elements.countryInput,
    getSelectedCountry: countries.getSelectedCountry,
    necessaryCookies,
    renderResults: results.renderResults,
    showInlineError,
    hideInlineError,
  });

  necessaryCookies.init();
  graph.initControls();
  plans.init();
  countries.init();
  calculationForm.init();

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

  window.onThemeChange = function () { graph.render(); };
})();

if (window.adsbygoogle && document.querySelector('.adsbygoogle')) {
  window.adsbygoogle.push({});
}
