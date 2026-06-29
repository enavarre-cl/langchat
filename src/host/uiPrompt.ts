/**
 * In-webview prompts: instead of a native VS Code modal, tool confirmations (run_command) and MCP
 * elicitations are rendered as a card over the chat composer. The host calls `uiPrompt(req)`; the
 * active chat editor registers an `Asker` (via `setUiAsker`) that posts the request to its webview
 * and resolves when the card replies. Pure bridge — no `vscode` import, so it's host-test friendly.
 */
export interface PromptField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  enum?: string[];
}
/** A request to show over the composer: a confirmation (no fields) or a small form (fields). */
export interface PromptRequest {
  title: string;
  detail?: string;       // e.g. the shell command, shown verbatim
  danger?: boolean;      // red styling for destructive confirms
  okLabel?: string;      // defaults to "OK"
  fields?: PromptField[];
}
export interface PromptResult { ok: boolean; values?: Record<string, unknown> }
export type Asker = (req: PromptRequest) => Promise<PromptResult>;

let asker: Asker | undefined;
/** The active chat editor wires its webview-backed asker here (on each inbound message). */
export function setUiAsker(fn: Asker): void { asker = fn; }
/** Ask the user via the webview card. With no chat editor wired, returns `{ ok: false }` (cancel). */
export function uiPrompt(req: PromptRequest): Promise<PromptResult> {
  return asker ? asker(req) : Promise.resolve({ ok: false });
}
