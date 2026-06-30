import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChatDoc, SysPromptFile } from './chatDocument';
import { tr } from './i18n';

/** Splits a path/glob into a LITERAL base (leading non-wildcard segments — may include `..`) and the
 *  glob remainder, so the caller can root a `findFiles` search at the resolved base. VS Code globs
 *  don't traverse `..` themselves, so `../systems/*.md` → base `../systems`, glob `*.md`. A pattern
 *  with no wildcard is a single literal file: base = its folder, glob = its basename. */
export function splitGlobPattern(pattern: string): { baseRel: string; globRel: string } {
  const segs = pattern.replace(/\\/g, '/').split('/');
  const isGlob = (s: string): boolean => /[*?{}[\]]/.test(s);
  const cut = segs.findIndex(isGlob);
  const baseRel = (cut === -1 ? segs.slice(0, -1) : segs.slice(0, cut)).join('/');
  const globRel = (cut === -1 ? segs.slice(-1) : segs.slice(cut)).join('/');
  return { baseRel, globRel };
}

/** Resolves the effective system prompt (file or inline) with a path allow-list. One dep: the doc. */
export function makeSystemPrompt(document: vscode.TextDocument) {
    const sysPromptRoots = (): string[] => [
      path.dirname(document.uri.fsPath),
      ...(vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
    ];
    const sysPromptPathAllowed = (resolved: string): boolean =>
      sysPromptRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep));

    // Per-layer "is this file actually reachable?" for the config UI (red marking). True = the path
    // escapes the allow-list or no file is there, so it will be SKIPPED at send time. An existing but
    // empty file is NOT flagged here (it still only warns at send time).
    const sysPromptLayerMissing = (part: SysPromptFile): boolean => {
      if (!part || typeof part.path !== 'string') return true;
      const resolved = path.resolve(path.dirname(document.uri.fsPath), part.path);
      if (!sysPromptPathAllowed(resolved)) return true;
      try { return !fs.statSync(resolved).isFile(); } catch { return true; }
    };

    let sysPromptWarned = ''; // debounce: warn once per failing-file set, not on every send

    // Assembles the EFFECTIVE system prompt: the inline base (if any) followed by every enabled .md
    // layer, in order, separated by exactly one blank line. Each segment's trailing whitespace is
    // trimmed first, so a file MISSING its final newline can't run into the next layer ("…rules.Next
    // rule…") and one with EXTRA trailing newlines can't balloon the gap. No side effects. `failures`
    // lists the layers that couldn't be read (missing, empty, or outside the workspace) so the caller can warn.
    const readSystemPrompt = (doc: ChatDoc): { text: string; failures: string[] } => {
      const dir = path.dirname(document.uri.fsPath);
      const segments: string[] = [];
      const failures: string[] = [];
      const base = doc.systemPrompt || '';
      if (base.trim()) segments.push(base);
      for (const part of doc.systemPromptFiles ?? []) {
        if (!part || typeof part.path !== 'string' || part.enabled === false) continue;
        const resolved = path.resolve(dir, part.path);
        if (!sysPromptPathAllowed(resolved)) { failures.push(part.path); continue; }
        try {
          const text = fs.readFileSync(resolved, 'utf8');
          if (text.trim()) segments.push(text);
          else failures.push(part.path);
        } catch { failures.push(part.path); }
      }
      const text = segments
        .map((s) => s.replace(/\s+$/, '')) // drop each layer's trailing whitespace…
        .filter((s) => s) // …(a now-empty layer adds no blank gap)
        .join('\n\n'); // …then separate every layer by exactly one blank line
      return { text, failures };
    };

    // Effective system prompt for sending; warns once (visibly) if any referenced layer couldn't be
    // used, instead of silently dropping it (which looks like the prompt is being ignored).
    const resolveSystemPrompt = (doc: ChatDoc): string => {
      const { text, failures } = readSystemPrompt(doc);
      const key = failures.join('\n');
      if (failures.length) {
        if (sysPromptWarned !== key) {
          sysPromptWarned = key;
          void vscode.window.showWarningMessage(
            `${tr('Some system-prompt files were skipped (missing, empty, or outside the workspace):')} ${failures.join(', ')}`
          );
        }
      } else {
        sysPromptWarned = '';
      }
      return text;
    };
  return { resolveSystemPrompt, readSystemPrompt, sysPromptPathAllowed, sysPromptLayerMissing };
}
