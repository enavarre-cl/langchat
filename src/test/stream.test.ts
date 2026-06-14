import { test } from 'node:test';
import assert from 'node:assert';
import { readLines } from '../providers/stream';

/** Crea un reader que emite `text` en trozos de `chunk` bytes (corta líneas a la mitad). */
function reader(text: string, chunk: number): ReadableStreamDefaultReader<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close(); },
  });
  return stream.getReader();
}

test('readLines reensambla líneas partidas entre chunks', async () => {
  const lines: string[] = [];
  await readLines(reader('alpha\nbeta\ngamma\n', 3), (l) => lines.push(l));
  assert.deepEqual(lines, ['alpha', 'beta', 'gamma']);
});

test('readLines recorta (trim) cada línea', async () => {
  const lines: string[] = [];
  await readLines(reader('  hola  \n\tmundo\t\n', 4), (l) => lines.push(l));
  assert.deepEqual(lines, ['hola', 'mundo']);
});

test('readLines preserva líneas vacías entre saltos', async () => {
  const lines: string[] = [];
  await readLines(reader('a\n\nb\n', 2), (l) => lines.push(l));
  assert.deepEqual(lines, ['a', '', 'b']);
});

test('readLines no emite la cola sin salto de línea final', async () => {
  const lines: string[] = [];
  await readLines(reader('uno\ndos', 100), (l) => lines.push(l));
  assert.deepEqual(lines, ['uno']); // "dos" queda en el buffer (sin \n)
});

test('readLines propaga si onLine lanza (error embebido en stream)', async () => {
  await assert.rejects(
    readLines(reader('data: x\ndata: BOOM\n', 5), (l) => { if (l.includes('BOOM')) throw new Error('boom'); }),
    /boom/,
  );
});
