/**
 * Composer: the input box, attachments (drag/drop, paste, file picker), send, streaming/
 * summarizing busy-state of the send button, and chat-local zoom.
 */
import { vscode } from '../core/vscode.js';
import { clampZoom, stepZoom } from '../../shared/zoomMath.js';
import { $ } from '../core/dom.js';
import { addFilesTo, renderAttachChips, filesFromClipboard } from './attachments.js';
import { getDoc } from '../ui/store.js';
import { clearNotices } from '../ui/notifications.js';
import { cancelOpenPrompt } from '../ui/prompt.js';
import { addMessage } from './message.js';
import { resetScroll, resetTools } from './conversation.js';
import { renderSpell, scheduleSpell } from '../features/spell.js';
import { handleFileKeydown, handleSuggestKeydown } from '../features/autocomplete.js';

const inputEl = $('input') as HTMLTextAreaElement;
const inputBackdrop = $('inputBackdrop');
const sendBtn = $('sendBtn');
const stopBtn = $('stopBtn');
const attachmentsEl = $('attachments');
const attachBtn = $('attachBtn');
const fileInput = $('fileInput') as HTMLInputElement;
const inputBox = $('inputBox');
const messagesEl = $('messages');

let pending = []; // pending attachments to send: {kind,name,mime,data}
let dragDepth = 0; // drag highlight nesting counter

// ---- Streaming / summarizing busy-state ----
let isStreaming = false;
export function setStreaming(on) {
  isStreaming = on;
  sendBtn.classList.toggle('hidden', on);
  stopBtn.classList.toggle('hidden', !on);
}
let isSummarizing = false;
export function setSummarizing(on) {
  isSummarizing = on;
  if (inputEl) inputEl.disabled = on;
  if (sendBtn) (sendBtn as HTMLButtonElement).disabled = on;
  if (inputBox) inputBox.classList.toggle('busy', on);
}

// ---- Attachments (helpers shared with inline editing: ./attachments.js) ----
  async function addFiles(files) { await addFilesTo(pending, files); renderPending(); }
  function renderPending() {
    attachmentsEl.classList.toggle('hidden', pending.length === 0);
    renderAttachChips(attachmentsEl, pending, renderPending);
  }

// ---- Send ----
function send() {
  const doc = getDoc();
  if (isStreaming || isSummarizing) return; // ignore sends while generating or summarizing
  const text = inputEl.value.trim();
  if (!text && pending.length === 0) return;
  clearNotices();
  cancelOpenPrompt(); // a new turn: dismiss any stale confirm/elicit card from before
  resetTools(); // a new turn begins: drop the previous turn's live tool activity
  resetScroll(); // on send, stick to the bottom again
  const attachments = pending.slice();
  addMessage('user', text, { attachments });
  if (doc) doc.messages.push({ role: 'user', content: text, attachments });
  inputEl.value = '';
  inputEl.style.height = 'auto';
  renderSpell(); // clear the overlay underline
  pending = [];
  renderPending();
  setStreaming(true); // block resends until streamEnd/error
  vscode.postMessage({ type: 'send', text, attachments });
}

// ---- Chat-local zoom (independent of VS Code global zoom) ----
  // Persisted per conversation in doc.ui.zoom (travels with the .chat). vscode.getState() is kept as a
  // fast local cache so the level is restored instantly on reload, before the doc message arrives.
  let zoom = clampZoom((vscode.getState() && vscode.getState().zoom) || 1);
  let zoomPersistTimer = 0;
  function applyZoom() {
    // Zoom ONLY the history (which has its own scroll), not the whole body: zooming the body
    // scaled the 100vh layout and overflowed/clipped the composer (the input bar).
    document.body.style.zoom = '';                // clear any previous zoom on body (legacy state)
    if (messagesEl) messagesEl.style.zoom = String(zoom);
    const lbl = $('zoomResetBtn');
    if (lbl) lbl.textContent = Math.round(zoom * 100) + '%';
    const s = vscode.getState() || {};
    s.zoom = zoom;
    vscode.setState(s);
  }
  // Debounced write to the .chat (wheel zoom fires rapidly; coalesce into one persisted value).
  function persistZoom() {
    const doc = getDoc();
    if (doc) doc.ui = Object.assign({}, doc.ui, { zoom });
    clearTimeout(zoomPersistTimer);
    zoomPersistTimer = setTimeout(() => vscode.postMessage({ type: 'setConfig', patch: { ui: { zoom } } }), 400);
  }
  function setZoom(z) { zoom = clampZoom(z); applyZoom(); persistZoom(); }

  // Applies the zoom persisted in the loaded conversation (no re-persist). Called when a doc arrives.
  export function applyDocZoom(doc) {
    const z = doc && doc.ui && doc.ui.zoom;
    if (typeof z === 'number' && isFinite(z)) { zoom = clampZoom(z); applyZoom(); }
  }

// Wires all composer DOM events. Called once at startup.
export function initComposer() {
  // UI events
  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  inputEl.addEventListener('keydown', (e) => {
    if (handleFileKeydown(e)) return;
    if (handleSuggestKeydown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, window.innerHeight * 0.4) + 'px';
    scheduleSpell();
  });
  inputEl.addEventListener('scroll', () => { if (inputBackdrop) inputBackdrop.scrollTop = inputEl.scrollTop; });
  // File picker + drag/drop + paste
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) addFiles([...fileInput.files]);
    fileInput.value = '';
  });
  document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; inputBox.classList.add('dragover'); });
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; inputBox.classList.remove('dragover'); } });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    inputBox.classList.remove('dragover');
    const f = e.dataTransfer && e.dataTransfer.files;
    if (f && f.length) addFiles([...f]);
  });
  inputEl.addEventListener('paste', (e) => {
    const files = filesFromClipboard(e);
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  // Zoom: Alt+wheel, Alt+0 handled in main; toolbar buttons here
  window.addEventListener('wheel', (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    zoom = stepZoom(zoom, e.deltaY);
    applyZoom();
    persistZoom();
  }, { passive: false });
  $('zoomInBtn').addEventListener('click', () => setZoom(stepZoom(zoom, -1)));
  $('zoomOutBtn').addEventListener('click', () => setZoom(stepZoom(zoom, 1)));
  $('zoomResetBtn').addEventListener('click', () => setZoom(1));
  applyZoom();
}

export { setZoom };
