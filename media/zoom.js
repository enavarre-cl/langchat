/**
 * Chat zoom math (pure, testable).
 * Dual mode: global `LangZoom` in the webview, `require()` in Node tests.
 */
(function (root) {
  var ZOOM_MIN = 0.6;
  var ZOOM_MAX = 2.5;
  var ZOOM_STEP = 0.1;

  /** Clamps and rounds to 2 decimal places (avoids 1.0000000002 from float additions). */
  function clampZoom(z) {
    if (typeof z !== 'number' || !isFinite(z)) return 1;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  }

  /** Next level according to wheel direction: deltaY<0 (up) zooms in. */
  function stepZoom(z, deltaY) {
    return clampZoom(z + (deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }

  var api = { clampZoom: clampZoom, stepZoom: stepZoom, ZOOM_MIN: ZOOM_MIN, ZOOM_MAX: ZOOM_MAX, ZOOM_STEP: ZOOM_STEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LangZoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
