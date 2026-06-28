// Ambient declarations for the webview ES modules: VS Code webview API, the classic
// scripts that set window.* globals (i18n/spell/zoom/spell-engine), and HTML-injected vars.
interface VsCodeApi {
  postMessage(msg: any): void;
  getState(): any;
  setState(state: any): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface Window {
  LangI18n: { t(s: string): string; get(): string; set(l: string): void; setBundle(b: any): void; applyStatic(d: Document): void; };
  LangSpell?: any;
  mermaid?: any;
  MERMAID_SRC?: string;
  JOTFLOW_NONCE?: string;
  DOWNLOADED_VOICES?: string[];
  PIPER_CUSTOM_SET?: boolean;
  CHATTERBOX_EXAGGERATION?: number;
  SPELL_DICTS?: any;
  ClipboardItem?: any;
  webkitAudioContext?: any;
  // legacy bridges (removed as modularization completes)
  PMd?: any; PMermaid?: any; PFind?: any;
}
declare var ClipboardItem: any;
