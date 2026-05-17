(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SFECalculatorConsent = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createNecessaryCookieController({ document, window, form, hideInlineError }) {
    let retryAfterNecessaryCookieConsent = false;
    let fallbackTimer = null;

    function hasNecessaryCookieConsent() {
      try {
        return decodeURIComponent(document.cookie || '').includes('CookieConsent=necessary:true');
      } catch (_err) {
        return false;
      }
    }

    function setNecessaryCookieConsent() {
      const maxAge = 365 * 24 * 60 * 60;
      const secure = window.location && window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `CookieConsent=necessary%3Atrue; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
    }

    function hasCookiebotUi() {
      const selectors = [
        '#CybotCookiebotDialog',
        '#CookiebotWidget',
        '#CookiebotWidgetUnderlay',
        '.CybotCookiebotDialog'
      ];
      return selectors.some((selector) => {
        const element = document.querySelector(selector);
        if (!element || element.hidden) return false;
        if (typeof window.getComputedStyle !== 'function') return true;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });
    }

    function scheduleFallbackCheck(delay) {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        if (!hasNecessaryCookieConsent() && !hasCookiebotUi()) {
          showBanner();
        }
      }, delay);
    }

    function retryPendingSubmit() {
      if (!retryAfterNecessaryCookieConsent) return;
      retryAfterNecessaryCookieConsent = false;
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }

    function showBanner() {
      if (hasNecessaryCookieConsent() || document.getElementById('necessary-cookie-banner')) return;

      const banner = document.createElement('div');
      banner.id = 'necessary-cookie-banner';
      banner.className = 'necessary-cookie-banner';
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-label', 'Necessary cookies');

      const text = document.createElement('p');
      text.textContent = 'This calculator uses necessary cookies for security and to run calculations. Cookiebot appears to be blocked, so optional cookie choices are unavailable here.';

      const actions = document.createElement('div');
      actions.className = 'necessary-cookie-actions';

      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'necessary-cookie-accept';
      acceptBtn.textContent = 'Use calculator';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'necessary-cookie-close';
      closeBtn.setAttribute('aria-label', 'Close necessary cookie message');
      closeBtn.textContent = 'Close';

      acceptBtn.addEventListener('click', () => {
        setNecessaryCookieConsent();
        banner.remove();
        hideInlineError();
        retryPendingSubmit();
      });
      closeBtn.addEventListener('click', () => banner.remove());

      actions.appendChild(acceptBtn);
      actions.appendChild(closeBtn);
      banner.appendChild(text);
      banner.appendChild(actions);
      document.body.appendChild(banner);
    }

    function init() {
      document.addEventListener('CookiebotOnLoad', () => {
        scheduleFallbackCheck(1500);
      });

      document.addEventListener('CookiebotOnAccept', () => {
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
      });

      document.addEventListener('CookiebotOnDecline', () => {
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
      });

      scheduleFallbackCheck(1200);
    }

    function requireConsentThenRetry() {
      retryAfterNecessaryCookieConsent = true;
      showBanner();
    }

    return {
      init,
      showBanner,
      requireConsentThenRetry,
      hasNecessaryCookieConsent,
    };
  }

  return { createNecessaryCookieController };
});
