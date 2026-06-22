/**
 * Pure find/replace helpers (no VS Code dependency), shared by the host's replace handlers and
 * testable in isolation. The webview builds an equivalent highlight regex (media/main.js); keep the
 * two `buildFindRegex` definitions semantically identical so highlight and replace never diverge.
 */

export interface FindOpts {
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  preserveCase?: boolean;
}

/** Build the search regex from the query + options. Returns null for an empty/invalid pattern. */
export function buildFindRegex(query: string, o: FindOpts): RegExp | null {
  if (query === '') return null;
  let pattern = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) pattern = `\\b${pattern}\\b`;
  try { return new RegExp(pattern, `g${o.matchCase ? '' : 'i'}`); } catch { return null; }
}

/** Expand $&, $1…$9 in a regex-mode replacement against the match. */
export function expandRefs(repl: string, m: RegExpExecArray): string {
  return repl.replace(/\$(\$|&|\d{1,2})/g, (_, k: string) => {
    if (k === '$') return '$';
    if (k === '&') return m[0];
    const i = parseInt(k, 10);
    return m[i] != null ? m[i] : '';
  });
}

/** Mirror the casing of `matched` onto `repl` (ALL CAPS → upper, Capitalized → capitalize). */
export function applyCase(matched: string, repl: string): string {
  if (matched && matched === matched.toUpperCase() && matched !== matched.toLowerCase()) return repl.toUpperCase();
  if (matched && matched[0] === matched[0].toUpperCase() && matched.slice(1) === matched.slice(1).toLowerCase()) {
    return repl.charAt(0).toUpperCase() + repl.slice(1);
  }
  return repl;
}

/**
 * Replace matches of `query` (with the find options) in `src`. `nth` = 0 replaces every occurrence;
 * `nth >= 1` replaces only that 1-based occurrence. Returns the new string and the replacement count.
 */
export function replaceInString(src: string, query: string, replacement: string, nth: number, o: FindOpts): { content: string; count: number } {
  const re = buildFindRegex(query, o);
  if (!re) return { content: src, count: 0 };
  let out = '', last = 0, occ = 0, count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; } // guard zero-width matches
    occ++;
    out += src.slice(last, m.index);
    if (nth === 0 || occ === nth) {
      let rep = o.regex ? expandRefs(replacement, m) : replacement;
      if (o.preserveCase) rep = applyCase(m[0], rep);
      out += rep; count++;
    } else {
      out += m[0];
    }
    last = m.index + m[0].length;
    if (nth !== 0 && occ === nth) break;
  }
  out += src.slice(last);
  return { content: out, count };
}
