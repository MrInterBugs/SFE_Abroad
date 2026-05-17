(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SFECalculatorAutocomplete = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createCountryAutocomplete({ document, countries, countryInput, acList, currencyBadge }) {
    let selectedCountry = null;
    let highlightIndex = -1;

    function filterCountries(query) {
      if (!query) return [];
      const lower = query.toLowerCase();
      return countries.filter(c => c.name.toLowerCase().includes(lower)).slice(0, 8);
    }

    function selectCountry(country) {
      selectedCountry = country;
      countryInput.value = country.name;
      currencyBadge.textContent = country.symbol || country.currency || '—';
      acList.classList.remove('open');
      document.getElementById('country-error').classList.remove('show');
      countryInput.classList.remove('error');
    }

    function renderSuggestions(items) {
      acList.innerHTML = '';
      highlightIndex = -1;
      if (items.length === 0) {
        acList.classList.remove('open');
        return;
      }

      items.forEach((country) => {
        const item = document.createElement('div');
        item.className = 'ac-item';
        item.setAttribute('role', 'option');

        const currencyLabel = [country.currency, country.symbol].filter(Boolean).join(' · ');
        const countryLabel = document.createElement('span');
        countryLabel.className = 'ac-country';
        countryLabel.textContent = country.name;
        const currency = document.createElement('span');
        currency.className = 'ac-currency';
        currency.textContent = currencyLabel;

        item.appendChild(countryLabel);
        item.appendChild(currency);
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          selectCountry(country);
        });
        acList.appendChild(item);
      });
      acList.classList.add('open');
    }

    function selectServerRenderedCountry() {
      const cookieCountry = countryInput.value.trim();
      if (!cookieCountry) return;
      const match = countries.find(c => c.name === cookieCountry);
      if (match) selectCountry(match);
    }

    function onCountryKeydown(event) {
      const items = acList.querySelectorAll('.ac-item');
      if (!items.length) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlightIndex = Math.min(highlightIndex + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIndex));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlightIndex = Math.max(highlightIndex - 1, 0);
        items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIndex));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const idx = highlightIndex >= 0 ? highlightIndex : 0;
        const matches = filterCountries(countryInput.value);
        if (matches[idx]) selectCountry(matches[idx]);
      } else if (event.key === 'Escape') {
        acList.classList.remove('open');
      }
    }

    function init() {
      selectServerRenderedCountry();

      countryInput.addEventListener('input', () => {
        selectedCountry = null;
        currencyBadge.textContent = '—';
        renderSuggestions(filterCountries(countryInput.value));
      });

      countryInput.addEventListener('keydown', onCountryKeydown);

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.autocomplete-wrap')) {
          acList.classList.remove('open');
        }
      });
    }

    return {
      init,
      getSelectedCountry: () => selectedCountry,
      filterCountries,
      selectCountry,
    };
  }

  return { createCountryAutocomplete };
});
