import './vscodeStub'; // must come first: stubs `vscode` for the modules pulled in below
import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { makeSystemPrompt } from '../systemPrompt';
import { ChatDoc, defaultDoc } from '../chatDocument';

/**
 * Layer concatenation (readSystemPrompt): the inline base + each enabled .md file's content must be
 * separated by exactly one blank line, regardless of the files' trailing newlines — a file missing a
 * final newline must not run into the next layer, and extra trailing newlines must not balloon the gap.
 */
const DEFAULTS = { provider: 'ollama' as const, temperature: 0.7, maxTokens: 2048 };

/** Writes the given files into a fresh temp dir and returns a readSystemPrompt bound to a .chat there. */
function setup(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jotflow-sysprompt-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  const fsPath = path.join(dir, 'chat.chat'); // the .chat lives in `dir`, so layers there are allow-listed
  const document = { uri: { fsPath, path: fsPath, toString: () => fsPath } } as unknown as vscode.TextDocument;
  const { readSystemPrompt } = makeSystemPrompt(document);
  return { readSystemPrompt, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function docWith(systemPrompt: string, paths: string[]): ChatDoc {
  const d = defaultDoc(DEFAULTS);
  d.systemPrompt = systemPrompt;
  d.systemPromptFiles = paths.map((p) => ({ path: p }));
  return d;
}

test('layers missing a trailing newline are still separated by a blank line (not stuck together)', () => {
  const { readSystemPrompt, cleanup } = setup({
    'a.md': 'Rule A1\nRule A2', // no trailing newline
    'b.md': 'Rule B1\nRule B2', // no trailing newline
  });
  try {
    const { text, failures } = readSystemPrompt(docWith('Base line.', ['a.md', 'b.md']));
    assert.equal(failures.length, 0);
    assert.equal(text, 'Base line.\n\nRule A1\nRule A2\n\nRule B1\nRule B2');
    assert.ok(!/Rule A2Rule B1/.test(text), 'adjacent layers must not run together');
  } finally { cleanup(); }
});

test('extra trailing newlines collapse to exactly one blank line between layers', () => {
  const { readSystemPrompt, cleanup } = setup({
    'a.md': 'Rule A\n\n\n', // several trailing newlines
    'b.md': 'Rule B\n', // one trailing newline
  });
  try {
    const { text } = readSystemPrompt(docWith('', ['a.md', 'b.md'])); // no inline base
    assert.equal(text, 'Rule A\n\nRule B');
  } finally { cleanup(); }
});
