/**
 * Separa, sobre un stream de texto, el razonamiento delimitado por <think>…</think>
 * del contenido de la respuesta. Tolera que las etiquetas lleguen partidas entre
 * varios deltas del stream.
 */
export function createThinkSplitter(
  onAnswer: (s: string) => void,
  onThink: (s: string) => void
) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let inThink = false;
  let buf = '';

  // Mayor sufijo de `s` que es prefijo de `tag` (posible etiqueta partida).
  function partialTail(s: string, tag: string): number {
    const max = Math.min(s.length, tag.length - 1);
    for (let k = max; k > 0; k--) {
      if (s.slice(s.length - k) === tag.slice(0, k)) return k;
    }
    return 0;
  }

  function run(flush: boolean): void {
    while (true) {
      const tag = inThink ? CLOSE : OPEN;
      const idx = buf.indexOf(tag);
      if (idx !== -1) {
        const before = buf.slice(0, idx);
        if (before) (inThink ? onThink : onAnswer)(before);
        buf = buf.slice(idx + tag.length);
        inThink = !inThink;
        continue;
      }
      if (flush) {
        if (buf) (inThink ? onThink : onAnswer)(buf);
        buf = '';
        return;
      }
      const keep = partialTail(buf, tag);
      const safe = buf.slice(0, buf.length - keep);
      if (safe) (inThink ? onThink : onAnswer)(safe);
      buf = buf.slice(buf.length - keep);
      return;
    }
  }

  return {
    push: (text: string) => {
      buf += text;
      run(false);
    },
    flush: () => run(true),
  };
}
