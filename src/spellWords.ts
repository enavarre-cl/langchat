import * as vscode from 'vscode';

export type SpellLang = 'es' | 'en';
export type SpellWordsMap = Record<SpellLang, string[]>;

function cleanList(v: any): string[] {
  return Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()) : [];
}

/**
 * User-defined spell-checker words, GLOBAL and PER LANGUAGE (es/en). Base dictionary words
 * (hunspell) do NOT live here. Persisted in globalStorage/spell-words.json. Single source of truth:
 * the sidebar view, dictionary panels and webviews all read/write here and stay in sync
 * via `onDidChange`.
 */
export class SpellWordsStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private data: SpellWordsMap | null = null; // null = not yet loaded

  constructor(private readonly context: vscode.ExtensionContext) {}

  private uri(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'spell-words.json');
  }

  private async load(): Promise<SpellWordsMap> {
    if (this.data) return this.data;
    try {
      const buf = await vscode.workspace.fs.readFile(this.uri());
      const raw = JSON.parse(Buffer.from(buf).toString('utf8'));
      this.data = { es: cleanList(raw.es), en: cleanList(raw.en) };
    } catch { this.data = { es: [], en: [] }; }
    return this.data;
  }

  async list(lang: SpellLang): Promise<string[]> { return (await this.load())[lang].slice(); }
  async all(): Promise<SpellWordsMap> { const d = await this.load(); return { es: d.es.slice(), en: d.en.slice() }; }

  private async persist(): Promise<void> {
    try { await vscode.workspace.fs.createDirectory(this.context.globalStorageUri); } catch { /* already exists */ }
    await vscode.workspace.fs.writeFile(this.uri(), Buffer.from(JSON.stringify(this.data) + '\n', 'utf8'));
    this._onDidChange.fire();
  }

  async add(lang: SpellLang, word: string): Promise<void> {
    const w = (word || '').trim();
    if (!w) return;
    const d = await this.load();
    if (!d[lang].includes(w)) {
      d[lang].push(w);
      d[lang].sort((a, b) => a.localeCompare(b));
      await this.persist();
    }
  }

  async remove(lang: SpellLang, word: string): Promise<void> {
    const d = await this.load();
    const i = d[lang].indexOf(word);
    if (i >= 0) { d[lang].splice(i, 1); await this.persist(); }
  }

  dispose(): void { this._onDidChange.dispose(); }
}
