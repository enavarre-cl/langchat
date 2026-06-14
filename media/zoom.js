/**
 * Matemática del zoom del chat (pura, testeable).
 * Doble modo: global `LangZoom` en el webview, `require()` en los tests Node.
 */
(function (root) {
  var ZOOM_MIN = 0.6;
  var ZOOM_MAX = 2.5;
  var ZOOM_STEP = 0.1;

  /** Acota y redondea a 2 decimales (evita 1.0000000002 por sumas de floats). */
  function clampZoom(z) {
    if (typeof z !== 'number' || !isFinite(z)) return 1;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  }

  /** Siguiente nivel según la dirección de la rueda: deltaY<0 (arriba) acerca. */
  function stepZoom(z, deltaY) {
    return clampZoom(z + (deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }

  var api = { clampZoom: clampZoom, stepZoom: stepZoom, ZOOM_MIN: ZOOM_MIN, ZOOM_MAX: ZOOM_MAX, ZOOM_STEP: ZOOM_STEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LangZoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
