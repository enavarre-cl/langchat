// Inline prompt card over the composer: renders a tool confirmation (run_command) or an MCP
// elicitation form from the host's `prompt` message, and replies with `promptResult`. Replaces the
// native VS Code modal. One card at a time; a new turn / new card dismisses a stale one.
import { vscode } from '../core/vscode.js';
import { $ } from '../core/dom.js';

interface PromptField { name: string; label: string; type: string; enum?: string[] }
interface PromptMsg { id: number; title?: string; detail?: string; danger?: boolean; okLabel?: string; fields?: PromptField[] }

let current: { id: number; el: HTMLElement } | null = null;

function reply(id: number, ok: boolean, values?: Record<string, unknown>): void {
  vscode.postMessage({ type: 'promptResult', id, ok, values });
}

/** Cancels the open card (if any) without a user click — e.g. when a new turn starts. */
export function cancelOpenPrompt(): void {
  if (current) { reply(current.id, false); current.el.remove(); current = null; }
}

export function showPrompt(msg: PromptMsg): void {
  cancelOpenPrompt(); // only one card at a time
  const host = $('notices');
  if (!host) return;

  const card = document.createElement('div');
  card.className = 'prompt-card' + (msg.danger ? ' danger' : '');

  const title = document.createElement('div');
  title.className = 'prompt-title';
  title.textContent = msg.title || '';
  card.appendChild(title);

  if (msg.detail) {
    const pre = document.createElement('pre');
    pre.className = 'prompt-detail';
    pre.textContent = msg.detail;
    card.appendChild(pre);
  }

  const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
  for (const f of msg.fields || []) {
    const row = document.createElement('label');
    row.className = 'prompt-field';
    const lbl = document.createElement('span');
    lbl.className = 'prompt-label';
    lbl.textContent = f.label;
    row.appendChild(lbl);
    let input: HTMLInputElement | HTMLSelectElement;
    if (f.type === 'enum') {
      const sel = document.createElement('select');
      for (const opt of f.enum || []) {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      }
      input = sel;
    } else {
      const inp = document.createElement('input');
      inp.type = f.type === 'boolean' ? 'checkbox' : f.type === 'number' ? 'number' : 'text';
      input = inp;
    }
    input.className = 'prompt-input';
    row.appendChild(input);
    inputs[f.name] = input;
    card.appendChild(row);
  }

  const actions = document.createElement('div');
  actions.className = 'prompt-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'prompt-btn cancel';
  cancelBtn.textContent = 'Cancel';
  const okBtn = document.createElement('button');
  okBtn.className = 'prompt-btn ok' + (msg.danger ? ' danger' : '');
  okBtn.textContent = msg.okLabel || 'OK';

  const close = (): void => { card.remove(); if (current && current.id === msg.id) current = null; };
  cancelBtn.addEventListener('click', () => { reply(msg.id, false); close(); });
  okBtn.addEventListener('click', () => {
    const values: Record<string, unknown> = {};
    for (const [name, el] of Object.entries(inputs)) {
      values[name] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    }
    reply(msg.id, true, values);
    close();
  });
  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  card.appendChild(actions);

  host.appendChild(card);
  current = { id: msg.id, el: card };
  const firstInput = card.querySelector('.prompt-input') as HTMLElement | null;
  (firstInput || okBtn).focus();
}
