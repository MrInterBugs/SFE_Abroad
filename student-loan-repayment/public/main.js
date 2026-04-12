$(document).ready(function () {
  const countriesByYear = JSON.parse($('#app-data').text());

  function updateCountryList() {
    const year = $('#selectedYear').val();
    const plan = $('#selectedPlan').val();
    const countryList = (countriesByYear[year] && countriesByYear[year][plan]) || [];

    $('#targetCountry').autocomplete({
      source: function (request, response) {
        const matcher = new RegExp($.ui.autocomplete.escapeRegex(request.term), 'i');
        response($.grep(countryList, function (item) {
          return matcher.test(item);
        }));
      },
      minLength: 0,
    }).focus(function () {
      $(this).autocomplete('search', '');
    });
  }

  updateCountryList();
  $('#selectedYear, #selectedPlan').on('change', updateCountryList);
});
