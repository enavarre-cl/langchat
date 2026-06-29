/**
 * MCP elicitation (`elicitation/create`): a server asks the user for structured input mid-operation.
 * The server sends a `message` + a flat `requestedSchema` (object of primitive props); we render it as
 * an in-webview card (via `uiPrompt`) and reply `{ action, content }`. Pure schema helpers (testable)
 * live alongside the prompt mapping — no `vscode` import; the UI is the webview card.
 */
import { uiPrompt, PromptField } from './uiPrompt';

export type ElicitAction = 'accept' | 'decline' | 'cancel';
export interface ElicitResult { action: ElicitAction; content?: Record<string, unknown> }

interface SchemaProp { type?: string; title?: string; description?: string; enum?: unknown[] }
export interface RequestedSchema { type?: string; properties?: Record<string, SchemaProp>; required?: string[] }

/** A "confirmation" elicitation = no inputs, or a single boolean field (a plain approve/deny). */
export function isConfirmation(schema: RequestedSchema | undefined): boolean {
  const keys = Object.keys(schema?.properties ?? {});
  if (keys.length === 0) return true;
  return keys.length === 1 && schema!.properties![keys[0]].type === 'boolean';
}

/** The `content` to reply with when a confirmation is auto-accepted: `{}` or `{ field: true }`. */
export function confirmationAcceptContent(schema: RequestedSchema | undefined): Record<string, unknown> {
  const keys = Object.keys(schema?.properties ?? {});
  return keys.length === 1 && schema!.properties![keys[0]].type === 'boolean' ? { [keys[0]]: true } : {};
}

/** Maps a schema property to a card field type. */
function fieldType(p: SchemaProp): PromptField['type'] {
  if (Array.isArray(p.enum) && p.enum.length) return 'enum';
  if (p.type === 'boolean') return 'boolean';
  if (p.type === 'number' || p.type === 'integer') return 'number';
  return 'string';
}

/** Renders the elicitation as an in-webview card and maps the answer to the MCP result. */
export async function runElicitation(message: string, schema: RequestedSchema | undefined): Promise<ElicitResult> {
  const props = schema?.properties ?? {};
  const keys = Object.keys(props);
  const fields: PromptField[] = keys.map((k) => ({
    name: k,
    label: props[k].title || props[k].description || k,
    type: fieldType(props[k]),
    enum: Array.isArray(props[k].enum) ? props[k].enum!.map(String) : undefined,
  }));

  const res = await uiPrompt({ title: message, fields, okLabel: keys.length ? 'Submit' : 'Allow' });
  if (!res.ok) return { action: keys.length ? 'cancel' : 'decline' };

  const content: Record<string, unknown> = {};
  for (const f of fields) {
    const v = res.values?.[f.name];
    content[f.name] = f.type === 'number' ? Number(v) : f.type === 'boolean' ? v === true : v;
  }
  return { action: 'accept', content };
}
