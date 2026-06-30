/**
 * Shared attachment helpers used by both the composer (new messages) and inline message editing:
 * turning picked / dropped / pasted files into attachment objects ({kind,name,mime,data}) and
 * rendering the removable chips. Blobs are inline base64 here; the host stores them into the
 * `.attach` sidecar on send/edit.
 */
import { t } from '../core/i18n.js';
import { setImageSrc } from '../core/dom.js';
import { notice } from '../ui/notifications.js';

const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20 MB, matching the host-side cap
const IMG_RE = /^image\//;
const TEXT_EXT = /\.(txt|md|json|csv|js|ts|tsx|jsx|py|java|c|cpp|h|go|rs|rb|php|html|css|scss|xml|yaml|yml|toml|ini|sh|sql|log|env)$/i;

function isTextLike(file) {
  if (/^text\//.test(file.type)) return true;
  if (/(json|xml|javascript|yaml|csv|markdown|x-sh|x-python)/i.test(file.type)) return true;
  if (!file.type) return TEXT_EXT.test(file.name || ''); // unknown mime: fall back to extension
  return false;
}
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const url = String(reader.result); resolve(url.slice(url.indexOf(',') + 1)); };
    reader.onerror = () => reject(reader.error || new Error('read error'));
    reader.readAsDataURL(file);
  });
}
export async function fileToAttachment(file) {
  if (IMG_RE.test(file.type)) {
    return { kind: 'image', name: file.name || 'image.png', mime: file.type || 'image/png', data: await readBase64(file) };
  }
  if (isTextLike(file)) {
    const text = await new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result));
      rd.onerror = () => reject(rd.error || new Error('read error'));
      rd.readAsText(file);
    });
    return { kind: 'text', name: file.name || 'file.txt', mime: file.type || 'text/plain', data: text };
  }
  // PDF, docx, binaries… → base64 document
  return { kind: 'document', name: file.name || 'document', mime: file.type || 'application/octet-stream', data: await readBase64(file) };
}

// Reads each file into `list` (mutated), enforcing the 20 MB cap and surfacing per-file errors as a
// notice. Returns true if anything was added.
export async function addFilesTo(list, files) {
  let added = false;
  for (const file of files) {
    if (file.size > MAX_ATTACH_BYTES) { notice(t('Attachment too large (max 20 MB): ') + file.name, true); continue; }
    try { list.push(await fileToAttachment(file)); added = true; }
    catch { notice(t('Could not read the file: ') + (file.name || ''), true); }
  }
  return added;
}

// Renders `list` as removable chips into `container`; `onChange` runs after a removal.
export function renderAttachChips(container, list, onChange) {
  container.innerHTML = '';
  list.forEach((a, i) => {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    if (a.kind === 'image') {
      const img = document.createElement('img');
      setImageSrc(img, a.mime, a.data);
      chip.appendChild(img);
    } else {
      chip.appendChild(document.createTextNode('📄 ' + a.name));
    }
    const x = document.createElement('button');
    x.textContent = '×'; x.title = t('Remove');
    x.addEventListener('click', () => { list.splice(i, 1); onChange(); });
    chip.appendChild(x);
    container.appendChild(chip);
  });
}

// The File[] carried by a paste event's clipboard.
export function filesFromClipboard(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  const files = [];
  for (const it of items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
  return files;
}
