document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-href]');
  if (btn) location.href = btn.dataset.href;
});
