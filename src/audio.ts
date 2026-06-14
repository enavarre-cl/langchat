/** Utilidades de audio/WAV y troceo de texto para TTS (puras, sin VS Code, testeables). */

/** Localiza el sub-chunk `data` de un WAV; devuelve dónde empieza el PCM y su longitud. */
export function wavData(buf: Buffer): { start: number; len: number } {
  let i = 12;
  while (i + 8 <= buf.length) {
    const id = buf.toString('ascii', i, i + 4);
    const sz = buf.readUInt32LE(i + 4);
    if (id === 'data') return { start: i + 8, len: Math.min(sz, buf.length - i - 8) };
    i += 8 + sz + (sz & 1);
  }
  return { start: 44, len: Math.max(0, buf.length - 44) };
}

/** Concatena varios WAV del MISMO formato en uno solo (reusa la cabecera del primero). */
export function concatWavs(buffers: Buffer[]): Buffer {
  if (!buffers.length) return Buffer.alloc(0);
  const d0 = wavData(buffers[0]);
  const header = Buffer.from(buffers[0].slice(0, d0.start)); // RIFF + fmt + 'data' + size
  const pcms = buffers.map((b) => { const d = wavData(b); return b.slice(d.start, d.start + d.len); });
  const total = pcms.reduce((s, p) => s + p.length, 0);
  header.writeUInt32LE(header.length + total - 8, 4); // tamaño del chunk RIFF
  header.writeUInt32LE(total, header.length - 4);     // tamaño del sub-chunk data
  return Buffer.concat([header, ...pcms]);
}

/** Parte un texto en trozos por frases (agrupando hasta ~maxLen) para TTS incremental. */
export function splitForTTS(text: string, maxLen = 350): string[] {
  const parts: string[] = [];
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?;\n]+[.!?;]*/g) || [text];
  let buf = '';
  const flush = () => { if (buf.trim()) parts.push(buf.trim()); buf = ''; };
  for (let s of sentences) {
    s = s.trim();
    if (!s) continue;
    // Frase más larga que maxLen: pártela por el último espacio antes del límite.
    while (s.length > maxLen) {
      let cut = s.lastIndexOf(' ', maxLen);
      if (cut < maxLen * 0.5) cut = maxLen;
      const piece = s.slice(0, cut).trim();
      if (piece) parts.push(piece);
      s = s.slice(cut).trim();
    }
    if ((buf + ' ' + s).trim().length > maxLen) flush();
    buf = buf ? buf + ' ' + s : s;
  }
  flush();
  return parts.length ? parts : [text];
}
