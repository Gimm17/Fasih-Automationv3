/**
 * FASIH Window.open Interceptor (runs in page context, CSP compliant via web_accessible_resources)
 */
(function() {
  'use strict';
  if (window.__fasih_interceptor_loaded) return;
  window.__fasih_interceptor_loaded = true;
  const _origOpen = window.open;
  window.open = function(url, target, features) {
    if (url) {
      window.postMessage({ type: 'FASIH_CAPTURED_OPEN_URL', url: String(url) }, '*');
    }
    return _origOpen.apply(this, arguments);
  };
})();
