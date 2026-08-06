// gpc-inject.js  — runs in the page's MAIN world at document_start, only while
// GPC enforcement is ON (registered/unregistered dynamically by the service worker).
//
// The Sec-GPC HTTP header (added via declarativeNetRequest) is what servers act on
// and what the law recognizes. This DOM property is the client-side half of the GPC
// spec: some consent scripts read navigator.globalPrivacyControl directly. We set
// both so a compliant site sees a consistent signal.
(function () {
  try {
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
      get: function () { return true; },
      configurable: true
    });
  } catch (e) {
    try { navigator.globalPrivacyControl = true; } catch (_) {}
  }
})();
