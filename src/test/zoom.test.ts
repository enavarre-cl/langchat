import { test } from 'node:test';
import assert from 'node:assert';
// Módulo dual-mode del webview (sin VS Code); se carga vía require desde Node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { clampZoom, stepZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } = require('../../media/zoom.js');

test('clampZoom respeta los límites', () => {
  assert.strictEqual(clampZoom(5), ZOOM_MAX);
  assert.strictEqual(clampZoom(0.1), ZOOM_MIN);
  assert.strictEqual(clampZoom(1), 1);
});

test('clampZoom redondea a 2 decimales (sin deriva de float)', () => {
  // 1 + 0.1 + 0.1 en float da 1.2000000000000002 → debe quedar 1.2
  assert.strictEqual(clampZoom(0.1 + 0.1 + 1), 1.2);
});

test('clampZoom devuelve 1 ante valores no numéricos o no finitos', () => {
  assert.strictEqual(clampZoom(NaN), 1);
  assert.strictEqual(clampZoom(Infinity), 1);
  assert.strictEqual(clampZoom('x'), 1); // entrada inválida a propósito
  assert.strictEqual(clampZoom(undefined), 1);
});

test('stepZoom acerca con deltaY negativo y aleja con positivo', () => {
  assert.strictEqual(stepZoom(1, -1), 1 + ZOOM_STEP); // rueda arriba → acerca
  assert.strictEqual(stepZoom(1, 1), 1 - ZOOM_STEP);  // rueda abajo → aleja
});

test('stepZoom no se pasa de los topes', () => {
  assert.strictEqual(stepZoom(ZOOM_MAX, -1), ZOOM_MAX); // ya en el máximo
  assert.strictEqual(stepZoom(ZOOM_MIN, 1), ZOOM_MIN);  // ya en el mínimo
});

test('stepZoom es estable acumulando pasos (sin deriva)', () => {
  let z = 1;
  for (let i = 0; i < 5; i++) z = stepZoom(z, -1); // 5 acercamientos
  assert.strictEqual(z, 1.5);
  for (let i = 0; i < 5; i++) z = stepZoom(z, 1); // 5 alejamientos
  assert.strictEqual(z, 1);
});
