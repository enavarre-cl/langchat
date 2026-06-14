import { test } from 'node:test';
import assert from 'node:assert';
import { splitForTTS, wavData, concatWavs } from '../audio';

/** Crea un WAV mínimo de cabecera 44 bytes + `pcm` bytes de datos. */
function makeWav(pcmLen: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcmLen, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(22050, 24); h.writeUInt32LE(44100, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcmLen, 40);
  return Buffer.concat([h, Buffer.alloc(pcmLen, 7)]);
}

test('splitForTTS divide por frases y no pierde texto', () => {
  const parts = splitForTTS('Hola mundo. ¿Cómo estás? Bien, gracias!');
  assert.ok(parts.length >= 1);
  assert.ok(parts.join(' ').includes('Hola mundo'));
  assert.ok(parts.join(' ').includes('gracias'));
});

test('splitForTTS parte frases más largas que maxLen', () => {
  const long = 'palabra '.repeat(100).trim(); // ~799 chars, una "frase" sin puntuación
  const parts = splitForTTS(long, 100);
  assert.ok(parts.length > 1, 'debería trocear');
  for (const p of parts) assert.ok(p.length <= 100, `trozo demasiado largo: ${p.length}`);
});

test('splitForTTS nunca devuelve vacío', () => {
  assert.deepEqual(splitForTTS('   '), ['   ']);
});

test('concatWavs suma el PCM y corrige las cabeceras de tamaño', () => {
  const a = makeWav(100), b = makeWav(250);
  const out = concatWavs([a, b]);
  const d = wavData(out);
  assert.equal(d.len, 350, 'PCM concatenado = suma');
  assert.equal(out.readUInt32LE(4), out.length - 8, 'RIFF size = fileSize-8');
  assert.equal(out.readUInt32LE(40), 350, 'data sub-chunk size');
  assert.equal(out.toString('ascii', 0, 4), 'RIFF');
  assert.equal(out.toString('ascii', 8, 12), 'WAVE');
});

test('concatWavs con lista vacía devuelve buffer vacío', () => {
  assert.equal(concatWavs([]).length, 0);
});
