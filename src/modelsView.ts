/** Vista lateral (TreeView) de modelos: estado del servidor + modelos locales con acciones. */
import * as vscode from 'vscode';
import { OllamaManager } from './ollama/manager';
import { listLocal, LocalModel } from './ollama/registry';
import { DownloadManager, DownloadItem } from './ollama/downloads';
import { formatBytes } from './ollama/parse';
import { SpellWordsStore } from './spellWords';
import { listPiperVoices } from './piperVoices';
import { PiperManager } from './piper/manager';
import { tr } from './i18n';

type Kind = 'group-engines' | 'engine' | 'group-models' | 'model' | 'group-downloads' | 'download'
  | 'group-dict' | 'dict-lang' | 'group-voices' | 'voice' | 'empty';

export class ModelsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: Kind,
    label: string,
    public readonly model?: LocalModel,
    public readonly download?: DownloadItem,
    public readonly word?: string
  ) {
    super(label);
  }
}

export class ModelsTreeProvider implements vscode.TreeDataProvider<ModelsTreeItem> {
  private readonly _onDidChange = new vscode.EventEmitter<ModelsTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private readonly manager: OllamaManager,
    private readonly downloads: DownloadManager,
    private readonly spell: SpellWordsStore,
    private readonly voicesDir: string,
    private readonly piper: PiperManager
  ) {
    manager.onDidChangeStatus(() => this.refresh());
    // Solo cambios de ESTADO (no progreso): así el árbol NO se recrea en cada tick y los clics en
    // los botones inline (cancelar/reintentar) nunca se pierden. El % en vivo va en el panel.
    downloads.onDidChangeState(() => this.refresh());
    spell.onDidChange(() => this.refresh());
    piper.onDidChange(() => this.refresh()); // daemon Piper arrancó/se detuvo
  }

  refresh(): void { this._onDidChange.fire(); }

  // Nodo de un idioma del diccionario; al hacer clic abre el panel de gestión. `word` lleva el lang.
  private dictLang(lang: string, label: string, count: number): ModelsTreeItem {
    const it = new ModelsTreeItem('dict-lang', count ? `${label} (${count})` : label, undefined, undefined, lang);
    it.contextValue = 'spellDictLang';
    it.iconPath = new vscode.ThemeIcon('book');
    it.command = { command: 'langChat.spell.openDictionary', title: tr('Dictionary'), arguments: [it] };
    return it;
  }

  // Nodo del motor Ollama: estado + contextValue que habilita las acciones (run/stop/install/…).
  private ollamaEngine(): ModelsTreeItem {
    const st = this.manager.status;
    const it = new ModelsTreeItem('engine', 'Ollama', undefined, undefined, 'ollama');
    let state: string;
    let icon: string;
    if (st === 'ready') { state = 'running'; it.description = tr('running'); icon = 'pass-filled'; }
    else if (st === 'downloading' || st === 'starting') { state = 'busy'; it.description = tr(st === 'downloading' ? 'downloading…' : 'starting…'); icon = 'loading~spin'; }
    else if (this.manager.isInstalled()) { state = 'stopped'; it.description = tr('stopped'); icon = 'circle-outline'; }
    else { state = 'notinstalled'; it.description = tr('not installed'); icon = 'cloud-download'; }
    it.contextValue = `engine.ollama.${state}`;
    it.tooltip = this.manager.detail || state;
    it.iconPath = new vscode.ThemeIcon(icon);
    return it;
  }

  // Nodo del motor Piper (TTS): no instalado / detenido / corriendo (daemon HTTP).
  private piperEngine(): ModelsTreeItem {
    const it = new ModelsTreeItem('engine', 'Piper (TTS)', undefined, undefined, 'piper');
    let state: string;
    let icon: string;
    if (!this.piper.isInstalled()) { state = 'notinstalled'; it.description = tr('not installed'); icon = 'cloud-download'; }
    else if (this.piper.isServerRunning()) { state = 'running'; it.description = tr('running'); icon = 'pass-filled'; }
    else { state = 'stopped'; it.description = tr('stopped'); icon = 'circle-outline'; }
    it.contextValue = `engine.piper.${state}`;
    it.iconPath = new vscode.ThemeIcon(icon);
    return it;
  }

  getTreeItem(el: ModelsTreeItem): vscode.TreeItem { return el; }

  async getChildren(el?: ModelsTreeItem): Promise<ModelsTreeItem[]> {
    if (!el) {
      // Raíz: motores + modelos + descargas + voces + diccionario.
      const engines = new ModelsTreeItem('group-engines', tr('Engines'));
      engines.contextValue = 'engines';
      engines.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      engines.iconPath = new vscode.ThemeIcon('server-environment');
      const group = new ModelsTreeItem('group-models', tr('Local models'));
      group.contextValue = 'ollamaModels';
      group.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      group.iconPath = new vscode.ThemeIcon('layers');
      // Sección de descargas: siempre visible (gestor persistente, con historial reintentable).
      const pending = this.downloads.pending();
      const dl = new ModelsTreeItem('group-downloads', pending.length ? `${tr('Downloads')} (${pending.length})` : tr('Downloads'));
      dl.contextValue = 'ollamaDownloads';
      dl.collapsibleState = pending.length
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      dl.iconPath = new vscode.ThemeIcon('cloud-download');
      // Diccionario personal del corrector (palabras propias del usuario, por idioma).
      const all = await this.spell.all();
      const total = all.es.length + all.en.length;
      const dict = new ModelsTreeItem('group-dict', total ? `${tr('Dictionary')} (${total})` : tr('Dictionary'));
      dict.contextValue = 'spellDictionary';
      dict.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      dict.iconPath = new vscode.ThemeIcon('book');
      // Voces Piper (TTS) descargadas.
      const voices = listPiperVoices(this.voicesDir);
      const vg = new ModelsTreeItem('group-voices', voices.length ? `${tr('Voices')} (${voices.length})` : tr('Voices'));
      vg.contextValue = 'piperVoices';
      vg.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      vg.iconPath = new vscode.ThemeIcon('unmute');
      return [engines, group, dl, vg, dict];
    }

    if (el.kind === 'group-engines') {
      return [this.ollamaEngine(), this.piperEngine()];
    }

    if (el.kind === 'group-voices') {
      const voices = listPiperVoices(this.voicesDir);
      if (!voices.length) {
        const empty = new ModelsTreeItem('empty', tr('No voices downloaded'));
        empty.iconPath = new vscode.ThemeIcon('info');
        return [empty];
      }
      return voices.map((v) => {
        const it = new ModelsTreeItem('voice', v.id, undefined, undefined, v.id);
        it.description = formatBytes(v.sizeBytes);
        it.contextValue = 'piperVoice';
        it.iconPath = new vscode.ThemeIcon('mic');
        return it;
      });
    }

    if (el.kind === 'group-dict') {
      const all = await this.spell.all();
      return [this.dictLang('es', 'Español', all.es.length), this.dictLang('en', 'English', all.en.length)];
    }

    if (el.kind === 'group-downloads') {
      const pending = this.downloads.pending();
      if (!pending.length) {
        const empty = new ModelsTreeItem('empty', tr('No downloads'));
        empty.iconPath = new vscode.ThemeIcon('inbox');
        return [empty];
      }
      return pending.map((d) => {
        const it = new ModelsTreeItem('download', d.label, undefined, d);
        // Clic en la fila → abre ese modelo en el explorador. (Ya no roba los clics de los botones
        // inline porque el árbol dejó de recrearse en cada tick — refresco coalescido.)
        it.command = { command: 'langChat.models.openModelFromDownload', title: tr('Local models'), arguments: [it] };
        if (d.state === 'queued') {
          it.description = tr('queued');
          it.iconPath = new vscode.ThemeIcon('clock');
          it.contextValue = 'ollamaDownload.queued';
        } else if (d.state === 'downloading') {
          // Sin % en vivo aquí (el árbol no se refresca por progreso); el % detallado está en el panel.
          it.description = tr('downloading…');
          it.iconPath = new vscode.ThemeIcon('loading~spin');
          it.contextValue = 'ollamaDownload.downloading';
        } else if (d.state === 'cancelled') {
          it.description = tr('cancelled');
          it.iconPath = new vscode.ThemeIcon('circle-slash');
          it.contextValue = 'ollamaDownload.failed';
        } else if (d.state === 'interrupted') {
          const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
          it.description = `${tr('interrupted')} ${pct}% — ${tr('retry to resume')}`;
          it.iconPath = new vscode.ThemeIcon('debug-pause');
          it.contextValue = 'ollamaDownload.failed';
          it.tooltip = d.error;
        } else { // error
          it.description = `${tr('error: ')}${d.error || ''}`;
          it.iconPath = new vscode.ThemeIcon('error');
          it.contextValue = 'ollamaDownload.failed';
          it.tooltip = d.error;
        }
        return it;
      });
    }

    if (el.kind === 'group-models') {
      const baseUrl = this.manager.baseUrl();
      if (!baseUrl || this.manager.status !== 'ready') {
        const empty = new ModelsTreeItem('empty', tr('Start the server to see the models'));
        empty.iconPath = new vscode.ThemeIcon('info');
        return [empty];
      }
      let models: LocalModel[];
      try { models = await listLocal(baseUrl); } catch (e: any) {
        const err = new ModelsTreeItem('empty', `${tr('Error: ')}${e?.message || e}`);
        err.iconPath = new vscode.ThemeIcon('error');
        return [err];
      }
      if (!models.length) {
        const empty = new ModelsTreeItem('empty', tr('No models. Press "Add" to download.'));
        empty.iconPath = new vscode.ThemeIcon('cloud-download');
        return [empty];
      }
      return models.map((m) => {
        const it = new ModelsTreeItem('model', m.name, m);
        it.description = [m.parameterSize, m.quantization, formatBytes(m.size)].filter(Boolean).join(' · ');
        it.tooltip = `${m.name}\n${formatBytes(m.size)}${m.family ? '\n' + m.family : ''}`;
        it.contextValue = 'ollamaModel';
        it.iconPath = new vscode.ThemeIcon('database');
        it.command = { command: 'langChat.models.openLocalModel', title: tr('Local models'), arguments: [it] };
        return it;
      });
    }

    return [];
  }
}
