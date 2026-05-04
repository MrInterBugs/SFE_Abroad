function decodedCookieValue(value) {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch (_err) {
    return '';
  }
}

function hasCookieConsent(req, category) {
  const raw = req.cookies?.CookieConsent;
  if (!category || !raw) return false;
  return decodedCookieValue(raw).includes(`${category}:true`);
}

module.exports = { decodedCookieValue, hasCookieConsent };
