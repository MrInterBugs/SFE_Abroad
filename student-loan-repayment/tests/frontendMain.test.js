'use strict';

class FakeClassList {
  constructor(el) {
    this.el = el;
    this.classes = new Set();
  }

  add(...names) {
    names.forEach((name) => this.classes.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.classes.delete(name));
  }

  contains(name) {
    return this.classes.has(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.classes.has(name) : Boolean(force);
    if (shouldAdd) this.classes.add(name);
    else this.classes.delete(name);
    return shouldAdd;
  }

  toString() {
    return Array.from(this.classes).join(' ');
  }
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.children = [];
    this.parentNode = null;
    this.events = {};
    this.style = {};
    this.attributes = {};
    this.classList = new FakeClassList(this);
  }

  set className(value) {
    this._className = value;
    this.classList = new FakeClassList(this);
    String(value || '').split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }

  get className() {
    return this._className || this.classList.toString();
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (child.tagName === 'SCRIPT' && typeof child.onload === 'function') {
      child.onload();
    }
    return child;
  }

  addEventListener(type, handler) {
    this.events[type] = this.events[type] || [];
    this.events[type].push(handler);
  }

  dispatch(type, event = {}) {
    const evt = {
      preventDefault: jest.fn(),
      target: this,
      ...event,
    };
    (this.events[type] || []).forEach((handler) => handler(evt));
    return evt;
  }

  querySelectorAll(selector) {
    if (selector === '.ac-item') {
      return this.children.filter((child) => child.classList.contains('ac-item'));
    }
    return [];
  }

  closest(selector) {
    if (selector === '.autocomplete-wrap') return this.inAutocomplete ? this : null;
    return null;
  }

  scrollIntoView() {}

  getContext() {
    return {};
  }
}

function createFakeDocument(appDataOverrides = {}) {
  const elements = new Map();
  const ids = [
    'app-data', 'country-input', 'ac-list', 'currency-badge', 'pgl-check', 'pgl-row',
    'calc-form', 'results-card', 'calc-btn', 'country-error', 'salary-input',
    'salary-error', 'csrf-input', 'calc-error', 'repayment-graph-panel',
    'loan-balance-input', 'pgl-balance-input', 'rate-slider', 'rate-display',
    'payrise-slider', 'payrise-display', 'plan2-rate-note', 'pgl-rate-note',
    'pgl-balance-row', 'writeoff-notice', 'writeoff-text', 'repayment-chart',
    'stat-interest', 'stat-paid', 'results-placeholder', 'res-monthly', 'res-annual',
    'res-threshold', 'res-rate', 'res-rate-sub', 'res-gbp', 'no-rep-notice',
    'no-rep-sub', 'breakdown-grid', 'bd-ug', 'bd-ug-rate', 'bd-pgl', 'bd-total',
  ];

  ids.forEach((id) => elements.set(id, new FakeElement('div', id)));

  elements.get('app-data').textContent = JSON.stringify({
    countries: [
      { name: 'Germany', currency: 'EUR', symbol: '€' },
      { name: 'Australia', currency: 'AUD', symbol: '$' },
    ],
    graduationDate: '2024-06',
    loanValueGbp: 12000,
    loanValuePglGbp: 3000,
    ...appDataOverrides,
  });
  elements.get('country-input').tagName = 'INPUT';
  elements.get('salary-input').tagName = 'INPUT';
  elements.get('csrf-input').tagName = 'INPUT';
  elements.get('calc-form').tagName = 'FORM';
  elements.get('calc-btn').textContent = 'Calculate monthly repayment';
  elements.get('currency-badge').textContent = '—';
  elements.get('loan-balance-input').value = '';
  elements.get('pgl-balance-input').value = '';
  elements.get('rate-slider').value = '3.2';
  elements.get('payrise-slider').value = '2';

  const labelForLoanBalance = new FakeElement('label');
  const documentEvents = {};
  const document = {
    head: new FakeElement('head'),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => elements.get(id) || null,
    querySelector: (selector) => {
      if (selector === 'label[for="loan-balance-input"]') return labelForLoanBalance;
      if (selector === '.adsbygoogle') return null;
      return null;
    },
    addEventListener: (type, handler) => {
      documentEvents[type] = documentEvents[type] || [];
      documentEvents[type].push(handler);
    },
    dispatch: (type, event = {}) => {
      (documentEvents[type] || []).forEach((handler) => handler(event));
    },
    elements,
    labelForLoanBalance,
  };

  global.document = document;
  global.window = {
    innerWidth: 1024,
    Chart: jest.fn(function Chart() {
      this.destroy = jest.fn();
    }),
    adsbygoogle: null,
  };
  global.Chart = global.window.Chart;
  global.requestAnimationFrame = (cb) => cb();
  global.URLSearchParams = URLSearchParams;
  global.FormData = class FakeFormData {
    constructor() {
      this.entries = [
        ['csrfToken', elements.get('csrf-input').value],
        ['targetCountry', elements.get('country-input').value],
        ['salaryLocalCurrency', elements.get('salary-input').value],
        ['selectedPlan', 'plan2'],
        ['selectedYear', '2026-27'],
        ['includePg', 'on'],
      ];
    }

    *[Symbol.iterator]() {
      yield* this.entries;
    }
  };

  return document;
}

function loadMain() {
  jest.resetModules();
  require('../public/main');
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('public/main.js frontend behavior', () => {
  afterEach(() => {
    delete global.document;
    delete global.window;
    delete global.Chart;
    delete global.fetch;
    delete global.requestAnimationFrame;
    delete global.FormData;
  });

  test('selects autocomplete countries and surfaces the necessary-cookie CSRF gate', async () => {
    const document = createFakeDocument({ graduationDate: null });
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    loadMain();

    const countryInput = document.getElementById('country-input');
    countryInput.value = 'Ger';
    countryInput.dispatch('input');

    const firstSuggestion = document.getElementById('ac-list').children[0];
    expect(firstSuggestion.children[0].textContent).toBe('Germany');
    firstSuggestion.dispatch('mousedown');
    expect(countryInput.value).toBe('Germany');
    expect(document.getElementById('currency-badge').textContent).toBe('€');

    document.getElementById('salary-input').value = '50000';
    document.getElementById('calc-form').dispatch('submit');
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/csrf-token', {
      headers: { Accept: 'application/json' },
    });
    expect(document.getElementById('calc-error').textContent).toBe('Please accept necessary cookies to use the calculator.');
    expect(document.getElementById('calc-error').hidden).toBe(false);
  });

  test('renders successful JSON calculation results, PGL breakdown, profile balances, and graph state', async () => {
    const document = createFakeDocument();
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ csrfToken: 'token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          monthlyRepayment: '240.00',
          pglMonthlyRepayment: '90.00',
          pglThresholdGbp: '21000.00',
          thresholdGbp: '18000.00',
          localPerGbp: '0.8696',
          salaryGbp: '57500.00',
          selectedPlan: 'plan2',
          selectedYear: '2026-27',
          salaryCurrencySymbol: '€',
          loanValueGbp: 12000,
          loanValuePglGbp: 3000,
        }),
      });
    loadMain();

    const countryInput = document.getElementById('country-input');
    countryInput.value = 'Ger';
    countryInput.dispatch('input');
    document.getElementById('ac-list').children[0].dispatch('mousedown');
    document.getElementById('salary-input').value = '50000';

    document.getElementById('calc-form').dispatch('submit');
    await flushPromises();

    expect(document.getElementById('csrf-input').value).toBe('token-123');
    expect(document.getElementById('res-monthly').textContent).toBe('£330.00');
    expect(document.getElementById('res-annual').textContent).toBe('£3,960/yr');
    expect(document.getElementById('res-threshold').textContent).toBe('£18,000');
    expect(document.getElementById('res-rate-sub').textContent).toBe('EUR per £1 GBP');
    expect(document.getElementById('breakdown-grid').classList.contains('show')).toBe(true);
    expect(document.getElementById('bd-ug').textContent).toBe('£240.00');
    expect(document.getElementById('bd-pgl').textContent).toBe('£90.00');
    expect(document.getElementById('loan-balance-input').value).toBe(12000);
    expect(document.getElementById('pgl-balance-input').value).toBe(3000);
    expect(document.getElementById('plan2-rate-note').style.display).toBe('block');
    expect(document.getElementById('pgl-rate-note').style.display).toBe('block');
    expect(document.getElementById('results-placeholder').style.display).toBe('none');
    expect(document.getElementById('results-card').classList.contains('visible')).toBe(true);
    expect(global.Chart).toHaveBeenCalledTimes(1);
  });
});
