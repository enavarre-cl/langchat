import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { buildProvider, chatDefaults, providerInfo, isProviderId, setApiKeyOverride, setManagedOllamaBaseUrl, ChatMessage, ProviderId } from './providers';
import { OllamaManager } from './ollama/manager';
import { DownloadManager } from './ollama/downloads';
import { ModelCardCache } from './ollama/cards';
import { ModelsTreeProvider, Section } from './modelsView';
import { ModelsPanel } from './modelsPanel';
import { remove as removeModel } from './ollama/registry';
import {
  ChatDoc,
  ChatParams,
  parseDoc,
  serializeDoc,
  defaultDoc,
} from './chatDocument';
import { renderWebviewHtml } from './webviewHtml';
import { AttachmentStore } from './attachmentStore';
import { runInference as runInferenceImpl } from './inference';
import { routeMessage } from './messageRouter';
import { makeChatOps } from './chatOps';
import { estTokens, errMsg } from './chatHelpers';
import { ToolHub } from './tools';
import { wavData, concatWavs, splitForTTS } from './audio';
import { initProxy } from './http';
import { tr, resolvedLang, activeBundle } from './i18n';
import { registerCompare } from './compareView';
import { SpellWordsStore, SPELL_LANGS } from './spellWords';
import { openDictionaryPanel } from './dictionaryPanel';
import { openVoicesPanel } from './voicesPanel';
import { removePiperVoice, listPiperVoices } from './piperVoices';
import { PiperManager } from './piper/manager';

// Tools hub (native filesystem + MCP servers), shared by all chats.
const toolHub = new ToolHub();

// Backends that use an API key (Ollama does not). The secret is stored as `parley.<id>.apiKey`.
const KEY_PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'openai', label: 'LM Studio / OpenAI' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'openrouter', label: 'OpenRouter' },
];

/** Loads API keys from SecretStorage (encrypted) into the provider overrides. */
async function loadApiKeys(context: vscode.ExtensionContext): Promise<void> {
  for (const { id } of KEY_PROVIDERS) {
    const k = await context.secrets.get(`parley.${id}.apiKey`);
    setApiKeyOverride(id, k || undefined);
  }
}

/** Extracts the HF repo id from a local Ollama model name (`hf.co/user/repo:quant` → `user/repo`). */
function localModelHfId(name?: string): string | undefined {
  if (!name || !/^hf\.co\//i.test(name)) return undefined;
  const id = name.replace(/^hf\.co\//i, '').replace(/:[^:/]+$/, '');
  return id || undefined;
}

export function activate(context: vscode.ExtensionContext) {
  const spellWords = new SpellWordsStore(context);
  context.subscriptions.push(spellWords);
  const piper = new PiperManager(context);
  // Notifies open chats when the set of downloaded voices changes (panel/tree) so that
  // the chat's voice selector only shows downloaded ones.
  const voicesChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(voicesChanged);
  // Notifies open chats when parley.language changes, so the UI re-translates live (no reload).
  const langChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(langChanged);
  const provider = new ChatEditorProvider(context, spellWords, piper, voicesChanged.event, langChanged.event);

  registerCompare(context); // version comparison command (Timeline / palette)

  initProxy(); // configures the proxy (http.proxy / env) for all requests
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('http')) initProxy();
      if (e.affectsConfiguration('parley.language')) langChanged.fire();
    })
  );
  void loadApiKeys(context); // populate overrides from SecretStorage on startup
  // If secrets change (another window, or the command), reload.
  context.secrets.onDidChange((e) => { if (e.key.startsWith('parley.') && e.key.endsWith('.apiKey')) void loadApiKeys(context); });

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(ChatEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand('parley.new', () => createNewChat()),
    vscode.commands.registerCommand('parley.spell.openDictionary', (item: any) => {
      const lang = item?.word === 'en' ? 'en' : 'es'; // the node carries the language in `word`
      openDictionaryPanel(context, spellWords, lang);
    }),
    vscode.commands.registerCommand('parley.setApiKey', async () => {
      const pick = await vscode.window.showQuickPick(
        KEY_PROVIDERS.map((p) => ({ label: p.label, id: p.id })),
        { placeHolder: tr('Backend for the API key') }
      );
      if (!pick) return;
      const key = await vscode.window.showInputBox({
        password: true,
        prompt: `${tr('API key for')} ${pick.label} ${tr('(empty = delete)')}`,
        placeHolder: '••••••••',
      });
      if (key === undefined) return; // cancelled
      const secretKey = `parley.${pick.id}.apiKey`;
      if (key) await context.secrets.store(secretKey, key);
      else await context.secrets.delete(secretKey);
      setApiKeyOverride(pick.id, key || undefined);
      vscode.window.showInformationMessage(`${tr('API key for')} ${pick.label} ${key ? tr('saved') : tr('deleted')} ${tr('(encrypted in SecretStorage).')}`);
    })
  );

  // ---- Local models (managed Ollama + explorer) ----
  const ollama = new OllamaManager(context, (s) => {
    if (vscode.workspace.getConfiguration('parley').get<boolean>('tts.debug', false)) console.log(s);
  });
  // Publishes the managed baseUrl so the Ollama provider can use it when ready.
  ollama.onDidChangeStatus(() => setManagedOllamaBaseUrl(ollama.status === 'ready' ? ollama.baseUrl() : undefined));
  const needServer = async (): Promise<string | undefined> => {
    try {
      // If ready, returns immediately; otherwise shows progress (first time downloads the binary).
      if (ollama.status === 'ready') return ollama.baseUrl();
      return await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Ollama' },
        () => ollama.start((received, total) => { void received; void total; })
      );
    } catch (e: any) { vscode.window.showErrorMessage(`Ollama: ${e?.message || e}`); return undefined; }
  };
  // Persistent downloads (survive restarts) that auto-start the server on (re)attempt.
  const downloads = new DownloadManager(
    () => needServer(),
    (name, modelPaths, projPath) => ollama.create(name, modelPaths, projPath),
    () => refreshTrees(),
    context.globalState,
    path.join(context.globalStorageUri.fsPath, 'imports')
  );
  const piperVoicesDir = vscode.Uri.joinPath(context.globalStorageUri, 'piper-voices').fsPath;
  // One view (TreeProvider) per section → VS Code gives them the native shaded header.
  const mkTree = (s: Section) => new ModelsTreeProvider(ollama, downloads, spellWords, piperVoicesDir, piper, s, voicesChanged.event);
  const treeEngines = mkTree('engines');
  const treeModels = mkTree('models'); // includes Local models + Downloads (tree)
  const treeVoices = mkTree('voices');
  const treeDict = mkTree('dictionary');
  const refreshTrees = (): void => { treeEngines.refresh(); treeModels.refresh(); treeVoices.refresh(); treeDict.refresh(); };
  // Card cache (sidecar): view/queue saves HF info; cancel/remove clears it.
  const cards = new ModelCardCache(path.join(context.globalStorageUri.fsPath, 'model-cards'));
  const panelHooks = {
    onChanged: () => refreshTrees(),
    useModel: async (name: string) => {
      if (ChatEditorProvider.activeApply) { await ChatEditorProvider.activeApply({ provider: 'ollama', model: name }); return true; }
      return false;
    },
  };

  // Installs/updates an engine showing progress. (Ollama "update" = reinstalls the pinned version.)
  const runEngineTask = async (which: any): Promise<void> => {
    if (which !== 'ollama' && which !== 'piper') return;
    const name = which === 'ollama' ? 'Ollama' : 'Piper';
    const title = tr('Installing engine…') + ` (${name})`;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, async (p) => {
        const notify = (m: string) => p.report({ message: m });
        if (which === 'ollama') await ollama.ensureBinary();
        else await piper.install(notify);
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`${name}: ${e?.message ?? e}`);
    }
    refreshTrees();
  };

  context.subscriptions.push(
    ollama,
    downloads,
    piper, // dispose() shuts down the HTTP daemon when the extension deactivates
    vscode.window.registerTreeDataProvider('parley.engines', treeEngines),
    vscode.window.registerTreeDataProvider('parley.models', treeModels),
    vscode.window.registerTreeDataProvider('parley.voices', treeVoices),
    vscode.window.registerTreeDataProvider('parley.dictionary', treeDict),
    vscode.commands.registerCommand('parley.models.add', () => ModelsPanel.show(context, ollama, downloads, cards, panelHooks)),
    vscode.commands.registerCommand('parley.models.openModelFromDownload', (item: any) => {
      const modelId = item?.download?.modelId;
      if (!modelId) return;
      ModelsPanel.show(context, ollama, downloads, cards, panelHooks);
      ModelsPanel.revealModel(modelId);
    }),
    vscode.commands.registerCommand('parley.models.cancelDownload', (item: any) => {
      if (item?.download) { cards.remove(item.download.modelId); downloads.cancel(item.download.id); }
    }),
    vscode.commands.registerCommand('parley.models.retryDownload', (item: any) => {
      if (item?.download?.id) downloads.retry(item.download.id);
    }),
    vscode.commands.registerCommand('parley.models.removeDownload', (item: any) => {
      if (item?.download) { cards.remove(item.download.modelId); downloads.remove(item.download.id); }
    }),
    vscode.commands.registerCommand('parley.models.clearDownloads', () => downloads.clearFinished()),
    vscode.commands.registerCommand('parley.models.refresh', () => refreshTrees()),
    vscode.commands.registerCommand('parley.tts.openVoices', () => {
      openVoicesPanel(context, piper, piperVoicesDir, () => { refreshTrees(); voicesChanged.fire(); });
    }),
    vscode.commands.registerCommand('parley.tts.startServer', async () => {
      const model = piper.firstVoiceModel();
      if (!model) { vscode.window.showInformationMessage(tr('Download a voice first from the Voices section.')); return; }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: tr('Starting the Piper server…') },
          (p) => piper.ensureServer(model, (m) => p.report({ message: m }))
        );
      } catch (e: any) { vscode.window.showErrorMessage(`Piper: ${e?.message ?? e}`); }
    }),
    vscode.commands.registerCommand('parley.tts.stopServer', () => piper.stopServer()),
    vscode.commands.registerCommand('parley.tts.removeVoice', async (item: any) => {
      const id = item?.word; // the voice node carries its id in `word`
      if (typeof id !== 'string') return;
      const yes = tr('Delete');
      const pick = await vscode.window.showWarningMessage(tr('Delete this voice?') + ` (${id})`, { modal: true }, yes);
      if (pick !== yes) return;
      removePiperVoice(piperVoicesDir, id);
      refreshTrees();
      voicesChanged.fire();
    }),
    vscode.commands.registerCommand('parley.engine.install', (item: any) => runEngineTask(item?.word)),
    vscode.commands.registerCommand('parley.engine.delete', async (item: any) => {
      const which = item?.word;
      if (which !== 'ollama' && which !== 'piper') return;
      const name = which === 'ollama' ? 'Ollama' : 'Piper';
      const yes = tr('Delete');
      if (await vscode.window.showWarningMessage(tr('Delete this engine?') + ` (${name})`, { modal: true }, yes) !== yes) return;
      if (which === 'ollama') { ollama.deleteBinary(); cards.clear(); } else { piper.delete(); voicesChanged.fire(); }
      refreshTrees();
    }),
    vscode.commands.registerCommand('parley.models.startServer', async () => { await needServer(); }),
    vscode.commands.registerCommand('parley.models.stopServer', () => { ollama.stop(); }),
    vscode.commands.registerCommand('parley.models.deleteModel', async (item: any) => {
      const name = item?.model?.name; const baseUrl = ollama.baseUrl();
      if (!name || !baseUrl) return;
      const ok = await vscode.window.showWarningMessage(`${tr('Delete the model')} ${name}?`, { modal: true }, tr('Delete'));
      if (ok !== tr('Delete')) return;
      try { await removeModel(baseUrl, name); refreshTrees(); }
      catch (e: any) { vscode.window.showErrorMessage(`${tr('Could not delete: ')}${e?.message || e}`); }
    }),
    vscode.commands.registerCommand('parley.models.openLocalModel', (item: any) => {
      const id = localModelHfId(item?.model?.name);
      if (!id) { vscode.window.showInformationMessage(tr('This model is not from Hugging Face.')); return; }
      ModelsPanel.show(context, ollama, downloads, cards, panelHooks);
      ModelsPanel.revealModel(id);
    })
  );
}

export function deactivate() {
  toolHub.dispose();
}

/** Creates a new `.chat` file (asking for a destination) and opens it with the chat editor. */
async function createNewChat(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = folder
    ? vscode.Uri.joinPath(folder, 'new.chat')
    : undefined;

  const target = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: tr('Create chat'),
    filters: { 'Parley': ['chat'] },
  });
  if (!target) return;

  const doc = defaultDoc(chatDefaults());
  await vscode.workspace.fs.writeFile(target, Buffer.from(serializeDoc(doc), 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', target, ChatEditorProvider.viewType);
}

class ChatEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'parley.editor';
  /** Applier for the focused chat: the models view uses it to "use this model". */
  static activeApply: ((patch: any) => Promise<void>) | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly spellWords: SpellWordsStore,
    private readonly piper: PiperManager,
    private readonly onVoicesChanged: vscode.Event<void>,
    private readonly onLangChanged: vscode.Event<void>
  ) {}

  /** Downloaded Piper voice ids, so the chat only offers those in its selector. */
  private downloadedVoiceIds(): string[] {
    return listPiperVoices(vscode.Uri.joinPath(this.context.globalStorageUri, 'piper-voices').fsPath).map((v) => v.id);
  }

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): void {
    const webview = panel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    webview.html = this.html(webview);

    // Text we write ourselves: to distinguish our own edits from external ones.
    let lastWritten: string | null = null;
    const abortRef: { current: AbortController | undefined } = { current: undefined };
    const busyRef = { value: false };
    const ttsTokenRef = { value: 0 };
    let currentPiperProc: any = null; // piper process in flight, so we can kill it on cancel
    const killPiper = () => { if (currentPiperProc) { try { currentPiperProc.kill(); } catch { /* nothing */ } currentPiperProc = null; } };
    // TTS trace to file (for debugging without relying on the webview console).
    const tlog = (s: string) => {
      // Only traces if the user enables debug (off by default).
      if (!vscode.workspace.getConfiguration('parley').get<boolean>('tts.debug', false)) return;
      try { console.log('[TTS]', s); } catch { /* nothing */ }
      try { fs.appendFileSync(path.join(os.tmpdir(), 'parley-tts.log'), new Date().toISOString() + ' ' + s + '\n'); } catch { /* nothing */ }
    };
    let modelContexts: Record<string, number> = {}; // model id -> context tokens
    // Cache of document parsing by version: parseDoc validates/normalises on every call and
    // getDoc is invoked many times per operation. We return a clone to avoid corrupting the cache.
    let docCache: { version: number; doc: ChatDoc } | null = null;

    const getDoc = (): ChatDoc | null => {
      if (docCache && docCache.version === document.version) {
        return structuredClone(docCache.doc);
      }
      try {
        const doc = parseDoc(document.getText(), chatDefaults());
        docCache = { version: document.version, doc };
        return structuredClone(doc);
      } catch (err: any) {
        webview.postMessage({ type: 'error', message: tr('The .chat file has invalid JSON: ') + (err?.message ?? err) });
        return null;
      }
    };

    // `save`/`prune` can be disabled for intermediate writes (e.g. each iteration
    // of the tool-loop): they are applied once at the end of the turn, avoiding flushing to disk
    // and rewriting the attachment sidecar on every step (O(n) cost per iteration).
    const writeDoc = async (doc: ChatDoc, opts?: { save?: boolean; prune?: boolean }): Promise<void> => {
      const save = opts?.save !== false;
      const prune = opts?.prune !== false;
      // Stamps id + timestamp on every message that doesn't have them yet (single place for all).
      for (const m of doc.messages) {
        if (!m.id) m.id = `msg_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
        if (!m.ts) m.ts = new Date().toISOString();
      }
      const text = serializeDoc(doc);
      if (text === document.getText()) return;
      lastWritten = text;
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      edit.replace(document.uri, fullRange, text);
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) {
        webview.postMessage({ type: 'error', message: tr('Could not write the .chat file.') });
        return;
      }
      // Persists to disk so configuration is not lost.
      if (save && !document.isUntitled) {
        await document.save();
      }
      // Cleans up orphan attachments from the sidecar after each persisted change.
      if (prune) await attachStore.prune(doc);
    };

    const pushDoc = (): void => {
      const doc = getDoc();
      if (doc) webview.postMessage({ type: 'doc', doc: resolveDocForView(doc) });
    };

    // Workspace file list for @-mention autocomplete (cached briefly; respects files/search excludes).
    let fileCache: string[] | null = null;
    let fileCacheAt = 0;
    const workspaceFiles = async (): Promise<string[]> => {
      if (fileCache && Date.now() - fileCacheAt < 15000) return fileCache;
      const uris = await vscode.workspace.findFiles(
        '**/*',
        '**/{node_modules,.git,out,dist,.next,build,coverage,.vscode-test}/**',
        5000
      );
      fileCache = uris.map((u) => vscode.workspace.asRelativePath(u, false)).sort((a, b) => a.localeCompare(b));
      fileCacheAt = Date.now();
      return fileCache;
    };
    const searchFiles = async (q: string): Promise<string[]> => {
      const all = await workspaceFiles();
      const ql = q.toLowerCase();
      if (!ql) return all.slice(0, 10);
      const base = (p: string) => (p.split('/').pop() || p).toLowerCase();
      const starts = all.filter((p) => base(p).startsWith(ql));
      const incl = all.filter((p) => !base(p).startsWith(ql) && p.toLowerCase().includes(ql));
      return [...starts, ...incl].slice(0, 10);
    };

    // Sends the effective language + its translation bundle to the webview (so a live change to any
    // locale re-translates without a reload — the webview can't carry every language's bundle).
    const pushLang = (): void => {
      webview.postMessage({ type: 'lang', lang: resolvedLang(), bundle: activeBundle() });
    };

    // Neural TTS with Piper: splits the text into sentences and sends each chunk as base64 WAV.
    // This way the first fragment plays immediately and no giant WAVs are generated for long messages.
    // `voice` is a curated voice id (downloaded automatically); if empty, uses the path from settings.
    const synthPiper = async (text: string, rate: number, voice: string, reqId: number): Promise<void> => {
      const t = text.trim();
      if (!t) return;
      const myToken = ++ttsTokenRef.value; // any later request/stop cancels this one
      const cancelled = () => myToken !== ttsTokenRef.value;
      killPiper(); // kill any piper from a previous request still in flight
      tlog(`req#${reqId} received (engine=piper, rate=${rate}, voice=${voice || '(setting)'})`);
      // All TTS messages carry the request id so the webview can filter stale ones.
      const post = (m: any) => webview.postMessage({ ...m, id: reqId });
      const notice = (m: string) => webview.postMessage({ type: 'notice', message: m });
      const cfg = vscode.workspace.getConfiguration('parley');
      const speaker = cfg.get<number>('tts.piperSpeaker', -1);
      const isCurated = !!voice && /^[a-z]{2}_[A-Z]{2}-/.test(voice);
      // Via DAEMON (resident model, fast): curated voices only. Any failure falls through to
      // the per-chunk spawn below, so there is no regression if the server fails to start.
      if (isCurated) {
        try {
          const modelPath = await this.piper.ensureVoice(voice, notice);
          if (cancelled()) return;
          const baseUrl = await this.piper.ensureServer(modelPath, notice);
          if (cancelled()) return;
          const lscale = rate > 0 ? 1 / rate : 1;
          const wav = await this.piper.synthViaServer(baseUrl, t, voice, lscale, typeof speaker === 'number' ? speaker : -1);
          if (cancelled()) return;
          tlog(`req#${reqId} OK via daemon: WAV ${wav.length} bytes`);
          post({ type: 'ttsAudio', data: wav.toString('base64'), last: true });
          post({ type: 'ttsDone' });
          return;
        } catch (e: any) {
          tlog(`req#${reqId} daemon failed (${e?.message ?? e}); falling back to per-chunk spawn`);
        }
      }
      let bin: string;
      try {
        bin = await this.piper.resolveBin(cfg, notice);
      } catch (e: any) {
        post({ type: 'ttsError', message: tr('Could not set up Piper: ') + (e?.message ?? e) });
        return;
      }
      if (cancelled()) return;
      let model = '';
      if (voice && /^[a-z]{2}_[A-Z]{2}-/.test(voice)) {
        try {
          model = await this.piper.ensureVoice(voice, notice);
        } catch (e: any) {
          post({ type: 'ttsError', message: tr('Could not download voice: ') + (e?.message ?? e) });
          return;
        }
      } else {
        model = cfg.get<string>('tts.piperModel', '') || '';
      }
      if (!model) {
        post({ type: 'ttsError', message: tr('No voice available. Download one from the Parley panel (Voices ➕), or set a custom .onnx path in Settings (parley.tts.piperModel).') });
        return;
      }
      if (cancelled()) return;

      const lengthScale = rate > 0 ? (1 / rate).toFixed(3) : '1';
      const libDir = path.dirname(bin);
      const env: any = { ...process.env };
      if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = libDir + (env.DYLD_LIBRARY_PATH ? ':' + env.DYLD_LIBRARY_PATH : '');
      } else if (process.platform === 'linux') {
        env.LD_LIBRARY_PATH = libDir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
      }

      // Synthesises a chunk and returns the WAV Buffer (or an error).
      const synthChunk = (chunk: string): Promise<{ ok: boolean; buf?: Buffer; err?: string }> =>
        new Promise((resolve) => {
          const out = path.join(os.tmpdir(), `parley-tts-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`);
          const args = ['--model', model, '--output_file', out, '--length_scale', lengthScale];
          if (typeof speaker === 'number' && speaker >= 0) args.push('--speaker', String(speaker));
          let proc: any;
          try {
            proc = cp.spawn(bin, args, { cwd: libDir, env });
          } catch (e: any) {
            return resolve({ ok: false, err: e?.message ?? String(e) });
          }
          currentPiperProc = proc; // so we can kill it if cancelled
          let stderr = '';
          proc.stderr?.on('data', (d: any) => { stderr += d.toString(); });
          proc.on('error', (e: any) => {
            if (currentPiperProc === proc) currentPiperProc = null;
            try { fs.unlinkSync(out); } catch { /* not created / already deleted */ }
            resolve({ ok: false, err: e?.message ?? String(e) });
          });
          proc.on('close', (code: number) => {
            if (currentPiperProc === proc) currentPiperProc = null;
            try {
              if (code === 0 && fs.existsSync(out)) resolve({ ok: true, buf: fs.readFileSync(out) });
              else resolve({ ok: false, err: stderr.trim() || `exit ${code}` });
            } finally {
              try { fs.unlinkSync(out); } catch { /* already deleted */ }
            }
          });
          proc.stdin?.write(chunk);
          proc.stdin?.end();
        });

      // Synthesises each sentence separately (fast) and concatenates them into a single WAV.
      const chunks = splitForTTS(t);
      tlog(`req#${reqId} bin=${bin.split('/').slice(-3).join('/')} chars=${t.length} chunks=${chunks.length}`);
      if (chunks.length > 1) webview.postMessage({ type: 'notice', message: tr('Generating audio…') });
      const bufs: Buffer[] = [];
      let lastErr = '';
      for (let i = 0; i < chunks.length; i++) {
        if (cancelled()) { tlog(`req#${reqId} cancelled at chunk ${i}`); return; }
        const r = await synthChunk(chunks[i]);
        if (cancelled()) { tlog(`req#${reqId} cancelled after chunk ${i}`); return; }
        if (r.ok && r.buf) bufs.push(r.buf);
        else { lastErr = r.err || ''; tlog(`req#${reqId} chunk ${i} FAILED: ${lastErr}`); }
      }
      if (cancelled()) return;
      if (!bufs.length) { tlog(`req#${reqId} no audio: ${lastErr}`); post({ type: 'ttsError', message: tr('Piper failed: ') + lastErr }); return; }
      const wav = concatWavs(bufs);
      tlog(`req#${reqId} OK: ${bufs.length} chunks → WAV ${wav.length} bytes (~${(wavData(wav).len / (22050 * 2)).toFixed(1)}s); sending`);
      // A single WAV → a single playback in the webview (no fragile chains).
      post({ type: 'ttsAudio', data: wav.toString('base64'), last: true });
      post({ type: 'ttsDone' });
    };

    // Roots a systemPromptFile may live in: the .chat's own folder + any workspace folder. Project
    // files are fine; a shared .chat still cannot pull arbitrary files (e.g. ../../etc/passwd) into
    // the prompt and exfiltrate them to the model.
    const sysPromptRoots = (): string[] => [
      path.dirname(document.uri.fsPath),
      ...(vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
    ];
    const sysPromptPathAllowed = (resolved: string): boolean =>
      sysPromptRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep));

    let sysPromptWarned = ''; // debounce: warn once per broken file, not on every send

    // Reads the EFFECTIVE system prompt (file if usable, else inline). No side effects.
    // `fileFailed` = a systemPromptFile was set but is missing/empty/outside the workspace.
    const readSystemPrompt = (doc: ChatDoc): { text: string; fileFailed: boolean } => {
      if (doc.systemPromptFile) {
        const resolved = path.resolve(path.dirname(document.uri.fsPath), doc.systemPromptFile);
        if (sysPromptPathAllowed(resolved)) {
          try {
            const text = fs.readFileSync(resolved, 'utf8');
            if (text.trim()) return { text, fileFailed: false };
          } catch { /* missing/unreadable */ }
        }
        return { text: doc.systemPrompt || '', fileFailed: true };
      }
      return { text: doc.systemPrompt || '', fileFailed: false };
    };

    // Effective system prompt for sending; warns once (visibly) if a referenced file couldn't be
    // used, instead of silently using the inline prompt (which looks like the prompt is ignored).
    const resolveSystemPrompt = (doc: ChatDoc): string => {
      const { text, fileFailed } = readSystemPrompt(doc);
      if (fileFailed) {
        const file = doc.systemPromptFile || '';
        if (sysPromptWarned !== file) {
          sysPromptWarned = file;
          void vscode.window.showWarningMessage(
            `${tr('System prompt file not used (missing, empty, or outside the workspace); using the inline prompt instead:')} ${file}`
          );
        }
      } else {
        sysPromptWarned = '';
      }
      return text;
    };

    // ---- Attachment sidecar (.attach): blobs live here, the .chat only holds references ----
    const attachStore = new AttachmentStore(document.uri);

    // Copy of the doc with resolved attachments (for the webview), without touching the persisted doc.
    // `sysPromptTokens` = tokens of the EFFECTIVE system prompt (file content included): the webview
    // only has the inline `systemPrompt`, so without this its context bar undercounts when a file is used.
    const resolveDocForView = (doc: ChatDoc): ChatDoc & { sysPromptTokens: number } => ({
      ...doc,
      sysPromptTokens: estTokens(readSystemPrompt(doc).text),
      messages: doc.messages.map((m) =>
        m.attachments ? { ...m, attachments: m.attachments.map(attachStore.resolve) } : m
      ),
    });

    const sendStatus = (state: 'checking' | 'ok' | 'error', detail = ''): void => {
      const doc = getDoc();
      if (!doc) return;
      webview.postMessage({ type: 'status', info: providerInfo(doc.provider), state, detail });
    };

    const loadModels = async (): Promise<void> => {
      const doc = getDoc();
      if (!doc) return;
      const info = providerInfo(doc.provider);
      sendStatus('checking');

      if (info.needsKey && !info.hasKey) {
        webview.postMessage({
          type: 'models',
          provider: doc.provider,
          models: [],
          current: '',
          error: `${tr('Missing the API key for')} ${info.label}. ${tr('Set it in the settings (🔧).')}`,
        });
        sendStatus('error', tr('missing API key'));
        return;
      }

      try {
        let models = await buildProvider(doc.provider).listModels();
        // Global OpenRouter vendor filter (prefix before '/').
        if (doc.provider === 'openrouter') {
          const cfg = vscode.workspace.getConfiguration('parley');
          const vendors = cfg.get<string[]>('openrouter.vendors', []);
          if (vendors.length) {
            models = models.filter((m) => vendors.includes(m.id.split('/')[0]));
          }
          // Custom model ids the API doesn't list (new/preview). Always included, before the vendor list.
          const custom = cfg.get<string[]>('openrouter.customModels', []).map((s) => (s || '').trim()).filter(Boolean);
          const present = new Set(models.map((m) => m.id));
          for (const id of [...custom].reverse()) {
            if (!present.has(id)) { models.unshift({ id }); present.add(id); }
          }
        }
        modelContexts = {};
        for (const m of models) if (m.contextLength) modelContexts[m.id] = m.contextLength;
        const ids = models.map((m) => m.id);
        let current = doc.model;
        if ((!current || !ids.includes(current)) && ids.length > 0) {
          current = ids[0];
          doc.model = current;
          await writeDoc(doc);
        }
        webview.postMessage({ type: 'models', provider: doc.provider, models, current });
        sendStatus('ok', `${models.length} ${tr(models.length === 1 ? 'model' : 'models')}`);
      } catch (err: any) {
        webview.postMessage({ type: 'models', provider: doc.provider, models: [], current: '', error: errMsg(err) });
        sendStatus('error', tr('no connection'));
      }
    };

    // Calls the model to summarise a block of messages (no streaming to the UI).
    const summarizeMessages = async (
      doc: ChatDoc,
      prevText: string,
      msgs: ChatMessage[]
    ): Promise<string> => {
      const convo = msgs
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      const instruction =
        (prevText
          ? `Previous summary of the conversation:\n${prevText}\n\nIntegrate the following new messages into a single updated summary.`
          : 'Summarize the following conversation.') +
        '\nKeep facts, decisions, data, names and pending tasks. Be concise. Reply with only the summary, in the same language as the conversation.\n\n--- Conversation ---\n' +
        convo;
      const wire: ChatMessage[] = [
        { role: 'system', content: 'You are an assistant that summarizes conversations to preserve context.' },
        { role: 'user', content: instruction },
      ];
      abortRef.current = new AbortController();
      let text = '';
      let reasoning = '';
      try {
        await buildProvider(doc.provider).chat(
          doc.model,
          wire,
          { temperature: 0.3, maxTokens: 1024 },
          {
            signal: abortRef.current!.signal,
            onDelta: (d) => { text += d; },
            onReasoning: (d) => { reasoning += d; },
          }
        );
      } finally {
        abortRef.current = undefined;
      }
      // Some reasoning models return text only in the thinking channel.
      return (text.trim() || reasoning.trim());
    };

    // Ensures a summary covering messages[0..targetUpTo); extends it incrementally.
    const ensureSummary = async (
      doc: ChatDoc,
      history: ChatMessage[],
      targetUpTo: number
    ): Promise<string> => {
      const prev = doc.summary;
      if (prev && prev.upTo >= targetUpTo) return prev.text;
      const startFrom = prev ? prev.upTo : 0;
      const block = history.slice(startFrom, targetUpTo);
      if (!block.length) return prev?.text ?? '';
      // PERSISTENT indicator (with spinner) throughout the model call; removed on completion
      // or failure. (Previously it was a notice that auto-closed after 6 s, leaving a feedback gap.)
      webview.postMessage({ type: 'summarizing', active: true, message: tr('🗜️ Summarizing previous context…') });
      try {
        const text = await summarizeMessages(doc, prev?.text ?? '', block);
        if (text) {
          doc.summary = { text, upTo: targetUpTo };
          await writeDoc(doc);
        }
        return doc.summary?.text ?? '';
      } finally {
        webview.postMessage({ type: 'summarizing', active: false });
      }
    };

    // Runs a streaming inference over `context`. Returns the accumulated result.
    // With `allowTools`, runs the agentic loop (MCP tools / native filesystem).
    const runInference = (doc: ChatDoc, context: ChatMessage[], allowTools = false) =>
      runInferenceImpl(doc, context, allowTools, {
        webview, toolHub, modelContexts, resolveSystemPrompt, ensureSummary,
        resolveAttachment: attachStore.resolve, getDoc, writeDoc, sendHistory, abortRef,
      });

    const { handleSend, handleGenerate, handleFork, handleContinue, handleRegenerate, setVariant, deleteVariant } =
      makeChatOps({ webview, document, getDoc, writeDoc, sendHistory: () => sendHistory(), runInference, attachStore, viewType: ChatEditorProvider.viewType });
    const sendHistory = (): void => {
      const doc = getDoc();
      // Include `summary`: the summary is created during inference and, without this, the webview
      // would be left with a stale summary (context bar counting the full history + no markers).
      if (doc) webview.postMessage({ type: 'history', messages: resolveDocForView(doc).messages, usage: doc.usage, summary: doc.summary ?? null });
    };

    // Asks for modal confirmation before deleting, unless the webview signals to skip it (Shift).
    const confirmDelete = async (msg: any, text: string): Promise<boolean> => {
      if (msg && msg.confirm === false) return true; // Shift: delete immediately
      const yes = tr('Delete');
      const pick = await vscode.window.showWarningMessage(text, { modal: true }, yes);
      return pick === yes;
    };

    const onMsg = webview.onDidReceiveMessage((msg: any) => routeMessage(msg, {
      webview, getDoc, writeDoc, pushDoc, pushLang, sendHistory, loadModels,
      handleSend, handleGenerate, handleFork, handleContinue, handleRegenerate, setVariant, deleteVariant,
      ensureSummary, synthPiper, killPiper, resolveSystemPrompt, tlog, applyPatch,
      abortRef, busyRef, ttsTokenRef,
      spellWords: this.spellWords, downloadedVoiceIds: () => this.downloadedVoiceIds(), piper: this.piper,
      globalStorageUri: this.context.globalStorageUri,
      document, searchFiles, sysPromptPathAllowed, confirmDelete, resolveAttachment: attachStore.resolve,
    }));

    // Syncs external document changes (manual JSON editing) without overwriting the in-progress
    // streaming (which we ourselves triggered).
    const onChange = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (document.getText() === lastWritten) return; // our own edit: already reflected in the webview
      // The .chat is a TextDocument, but the chat owns its history (delete/edit/regenerate/fork).
      // VS Code's text undo/redo steps through the many internal writes of a turn, erratically
      // reverting or duplicating messages. Neutralize it: snap the document back to the last state
      // we wrote. (The webview keeps native undo inside its own input fields via execCommand.)
      if (lastWritten !== null &&
          (e.reason === vscode.TextDocumentChangeReason.Undo || e.reason === vscode.TextDocumentChangeReason.Redo)) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          lastWritten
        );
        void vscode.workspace.applyEdit(edit);
        return;
      }
      if (busyRef.value) return; // don't reconcile/re-render mid-turn — it would disrupt the streaming bubble
      pushDoc();
    });

    // The models view can apply a provider+model to the currently focused chat.
    const applyConfig = async (patch: any): Promise<void> => {
      if (busyRef.value) return;
      const doc = getDoc();
      if (!doc) return;
      const before = doc.provider;
      applyPatch(doc, patch);
      await writeDoc(doc);
      if (doc.provider !== before) await loadModels();
      pushDoc();
    };
    // Points to the LAST active chat. We don't clear it on focus loss: if we did, focusing the
    // sidebar to "Use in chat" would lose the reference. It is only cleared on dispose.
    const setActive = (active: boolean): void => {
      if (active) ChatEditorProvider.activeApply = applyConfig;
    };
    setActive(panel.active);
    const onState = panel.onDidChangeViewState(() => setActive(panel.active));

    // Any change to the personal dictionary (panel, another chat) → refreshes this webview.
    const onSpell = this.spellWords.onDidChange(async () => webview.postMessage({ type: 'spellWords', words: await this.spellWords.all() }));
    // Change in downloaded voices (voices panel, tree) → re-filters the chat selector.
    const onVoices = this.onVoicesChanged(() => webview.postMessage({ type: 'piperVoices', ids: this.downloadedVoiceIds() }));
    // parley.language changed in settings → re-translate the UI live (no reload needed).
    const onLang = this.onLangChanged(() => pushLang());
    panel.onDidDispose(() => {
      abortRef.current?.abort();
      onMsg.dispose();
      onChange.dispose();
      onState.dispose();
      onSpell.dispose();
      onVoices.dispose();
      onLang.dispose();
      if (ChatEditorProvider.activeApply === applyConfig) ChatEditorProvider.activeApply = undefined;
    });
  }

  private html(webview: vscode.Webview): string {
    return renderWebviewHtml(webview, {
      extensionUri: this.context.extensionUri,
      lang: resolvedLang(),
      bundle: activeBundle(),
      downloadedVoices: this.downloadedVoiceIds(),
      piperCustomSet: !!vscode.workspace.getConfiguration("parley").get<string>("tts.piperModel", ""),
    });
  }
}

const TOGGLE_KEYS: (keyof ChatParams)[] = [
  'maxTokens', 'contextMessages', 'contextLength', 'numThreads', 'topK', 'topP', 'minP', 'topA',
  'repeatPenalty', 'presencePenalty', 'frequencyPenalty', 'seed',
];

/** Applies to `doc` only the valid keys arriving from the webview (including nested config). */
function applyPatch(doc: ChatDoc, patch: any): void {
  if (!patch || typeof patch !== 'object') return;
  if (typeof patch.title === 'string') doc.title = patch.title;
  if (isProviderId(patch.provider)) {
    doc.provider = patch.provider;
  }
  if (typeof patch.model === 'string') doc.model = patch.model;
  if (typeof patch.systemPrompt === 'string') doc.systemPrompt = patch.systemPrompt;
  if (['auto', 'off', ...SPELL_LANGS].includes(patch.spellLang)) doc.spellLang = patch.spellLang;

  const p = patch.params;
  if (p && typeof p === 'object') {
    if (typeof p.temperature === 'number' && !Number.isNaN(p.temperature)) {
      doc.params.temperature = p.temperature;
    }
    if (Array.isArray(p.stop)) {
      doc.params.stop = p.stop.filter((s: any) => typeof s === 'string');
    }
    if (typeof p.thinking === 'boolean') {
      doc.params.thinking = p.thinking;
    }
    if (typeof p.autoSummary === 'boolean') {
      doc.params.autoSummary = p.autoSummary;
    }
    if (typeof p.tools === 'boolean') {
      doc.params.tools = p.tools;
    }
    for (const key of TOGGLE_KEYS) {
      const incoming = p[key];
      if (!incoming || typeof incoming !== 'object') continue;
      const current = doc.params[key] as { enabled: boolean; value: number };
      if (typeof incoming.enabled === 'boolean') current.enabled = incoming.enabled;
      if (typeof incoming.value === 'number' && !Number.isNaN(incoming.value)) {
        current.value = incoming.value;
      }
    }
  }
}


