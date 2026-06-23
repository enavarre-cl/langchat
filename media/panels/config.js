/**
 * Configuration panel (⚙): system prompt, sampling parameters (schema-driven), and the
 * read-aloud (TTS) section. Posts config patches to the host.
 */
import { t } from '../core/i18n.js';
import { vscode } from '../core/vscode.js';
import { $, escapeHtml } from '../core/dom.js';
import { getDoc } from '../ui/store.js';
import { tts } from '../features/tts.js';
import { updateContextBar } from './models.js';
import { renderConversation } from '../chat/conversation.js';
import { renderTtsConfig } from './configTts.js';

const configFields = $('configFields');

const SLIDER_STEP = 0.01; // decimal precision for fractional sliders/number inputs

// Configuration panel schema. `only` restricts a parameter to certain backends.
  const SCHEMA = [
    { group: 'General', items: [
      { key: 'temperature', label: 'Temperature', kind: 'slider', min: 0, max: 2, step: SLIDER_STEP, toggle: false },
      { key: 'maxTokens', label: 'Limit response length', kind: 'int', min: 1, max: 131072, step: 1, toggle: true },
      { key: 'contextMessages', label: 'History to send: last N messages', kind: 'int', min: 1, max: 500, step: 1, toggle: true },
      { key: 'autoSummary', label: 'Auto-summarize when context fills up', kind: 'bool' },
      { key: 'contextLength', label: 'Model window: num_ctx (tokens)', kind: 'int', min: 256, max: 131072, step: 256, toggle: true, only: ['ollama'] },
      { key: 'numThreads', label: 'CPU Threads', kind: 'slider', min: 1, max: 32, step: 1, toggle: true, only: ['ollama'] },
      { key: 'thinking', label: 'Reasoning / thinking', kind: 'bool', only: ['gemini', 'anthropic', 'openrouter', 'ollama'] },
      { key: 'tools', label: 'Tools: workspace filesystem + MCP servers (.mcp)', kind: 'bool', only: ['openai', 'openrouter', 'gemini', 'anthropic', 'ollama'] },
      { key: 'stop', label: 'Stop Strings', kind: 'tags' },
    ] },
    { group: 'Sampling', items: [
      { key: 'topK', label: 'Top K Sampling', kind: 'int', min: 0, max: 500, step: 1, toggle: true },
      { key: 'topP', label: 'Top P Sampling', kind: 'slider', min: 0, max: 1, step: SLIDER_STEP, toggle: true },
      { key: 'minP', label: 'Min P Sampling', kind: 'slider', min: 0, max: 1, step: SLIDER_STEP, toggle: true, only: ['openai', 'ollama', 'openrouter'] },
      { key: 'topA', label: 'Top A Sampling', kind: 'slider', min: 0, max: 1, step: SLIDER_STEP, toggle: true, only: ['openrouter'] },
      { key: 'repeatPenalty', label: 'Repeat / Repetition Penalty', kind: 'number', min: 0, max: 2, step: SLIDER_STEP, toggle: true, only: ['openai', 'ollama', 'openrouter'] },
      { key: 'presencePenalty', label: 'Presence Penalty', kind: 'number', min: -2, max: 2, step: SLIDER_STEP, toggle: true, only: ['openai', 'ollama', 'openrouter', 'gemini'] },
      { key: 'frequencyPenalty', label: 'Frequency Penalty', kind: 'number', min: -2, max: 2, step: SLIDER_STEP, toggle: true, only: ['openai', 'ollama', 'openrouter', 'gemini'] },
      { key: 'seed', label: 'Seed', kind: 'int', min: 0, max: 2147483647, step: 1, toggle: true, only: ['openai', 'ollama', 'openrouter', 'gemini'] },
    ] },
  ];

  function patchConfig(patch) {
    const doc = getDoc();
    if (doc) {
      if (patch.params) {
        doc.params = doc.params || {};
        for (const k of Object.keys(patch.params)) doc.params[k] = patch.params[k];
      }
      for (const k of Object.keys(patch)) if (k !== 'params') doc[k] = patch[k];
    }
    vscode.postMessage({ type: 'setConfig', patch });
    updateContextBar();
    // If something that shifts the context dividers changed (last N / summary / budget),
    // re-render the conversation so the ✂️/🗜️ markers and dimming reflect the new state.
    if (patch.params && ('contextMessages' in patch.params || 'autoSummary' in patch.params)) {
      renderConversation();
    }
  }
  const patchParam = (key, value) => patchConfig({ params: { [key]: value } });

  // ---- Configuration panel rendering ----
  function renderConfig() {
    const doc = getDoc();
    if (!doc) return;
    // Backend and model are static in the HTML; here only system prompt + parameters.
    configFields.innerHTML = '';

    // System prompt: reference to a .md file, or inline.
    if (doc.systemPromptFile) {
      const ref = document.createElement('div');
      ref.className = 'sysref';
      const name = document.createElement('span');
      name.className = 'sysref-name';
      name.textContent = '📄 ' + doc.systemPromptFile;
      const open = document.createElement('button');
      open.textContent = t('Open'); open.title = t('Open the .md file');
      open.addEventListener('click', () => vscode.postMessage({ type: 'openSysPrompt' }));
      const clear = document.createElement('button');
      clear.textContent = t('Remove'); clear.title = t('Back to inline system prompt');
      clear.addEventListener('click', () => vscode.postMessage({ type: 'clearSysPrompt' }));
      ref.appendChild(name); ref.appendChild(open); ref.appendChild(clear);
      configFields.appendChild(fieldRow(t('System prompt (file)'), ref));
    } else {
      const sys = document.createElement('textarea');
      sys.className = 'sys-area';
      sys.spellcheck = true; sys.lang = window.LangI18n.get();
      sys.rows = 2; sys.value = doc.systemPrompt; sys.placeholder = t('System instructions…');
      const sysAutosize = () => { sys.style.height = 'auto'; sys.style.height = Math.min(sys.scrollHeight, 320) + 'px'; };
      sys.addEventListener('input', sysAutosize);
      sys.addEventListener('change', () => patchConfig({ systemPrompt: sys.value }));
      requestAnimationFrame(sysAutosize);
      const actions = document.createElement('div');
      actions.className = 'sysref-actions';
      const create = document.createElement('button');
      create.textContent = t('Save');
      create.title = t('Save the prompt to a .md file and reference it');
      create.addEventListener('click', () => vscode.postMessage({ type: 'createSysPrompt' }));
      const pick = document.createElement('button');
      pick.textContent = t('Load');
      pick.title = t('Use an existing .md file');
      pick.addEventListener('click', () => vscode.postMessage({ type: 'pickSysPrompt' }));
      actions.appendChild(create); actions.appendChild(pick);
      const wrap = document.createElement('div');
      wrap.appendChild(sys); wrap.appendChild(actions);
      configFields.appendChild(fieldRow('System prompt', wrap));
    }

    // Parameter groups, filtered by the active backend (hides empty groups).
    const provider = doc.provider;
    for (const section of SCHEMA) {
      const items = section.items.filter((it) => !it.only || it.only.includes(provider));
      if (!items.length) continue;
      const h = document.createElement('div');
      h.className = 'group-head';
      h.textContent = t(section.group);
      configFields.appendChild(h);
      for (const item of items) configFields.appendChild(paramRow(item));
    }

    // Read aloud (system engine or neural Piper).
    renderTtsConfig();
  }

  function fieldRow(label, control) {
    const row = document.createElement('div');
    row.className = 'cfg-row';
    const l = document.createElement('label');
    l.textContent = label;
    row.appendChild(l);
    row.appendChild(control);
    return row;
  }

  // Dispatches to a per-kind builder; every branch produces the same `cfg-row param` element.
  function paramRow(item) {
    const doc = getDoc();
    const p = doc.params || {};
    const row = document.createElement('div');
    row.className = 'cfg-row param';

    if (item.kind === 'tags') return paramRowTags(item, p, row);
    if (item.kind === 'bool') return paramRowBool(item, p, row);
    return paramRowNumeric(item, p, row);
  }

  function paramRowTags(item, p, row) {
    row.appendChild(tagsControl(item, p));
    return row;
  }

  function paramRowBool(item, p, row) {
    const head = document.createElement('div');
    head.className = 'param-head';
    const left = document.createElement('div');
    left.className = 'param-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!p[item.key];
    row.classList.toggle('disabled', !cb.checked); // dim when off
    cb.addEventListener('change', () => {
      row.classList.toggle('disabled', !cb.checked);
      patchParam(item.key, cb.checked);
    });
    const lab = document.createElement('span');
    lab.textContent = t(item.label);
    left.appendChild(cb);
    left.appendChild(lab);
    head.appendChild(left);
    row.appendChild(head);
    return row;
  }

  // Numeric kinds: 'int' / 'number' (box only) and 'slider' (box + range).
  function paramRowNumeric(item, p, row) {
    const val = p[item.key];
    const enabled = item.toggle ? !!(val && val.enabled) : true;
    const numValue = item.toggle ? (val ? val.value : item.min) : (typeof val === 'number' ? val : item.min);

    // Header: [checkbox] label ............ [numeric box]
    const head = document.createElement('div');
    head.className = 'param-head';

    const left = document.createElement('div');
    left.className = 'param-label';
    let check = null;
    if (item.toggle) {
      check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = enabled;
      left.appendChild(check);
    }
    const lab = document.createElement('span');
    lab.textContent = t(item.label);
    left.appendChild(lab);
    head.appendChild(left);

    const numBox = document.createElement('input');
    numBox.type = 'number';
    numBox.className = 'param-num';
    numBox.min = item.min; numBox.max = item.max; numBox.step = item.step;
    numBox.value = String(numValue);
    head.appendChild(numBox);
    row.appendChild(head);

    let slider = null;
    if (item.kind === 'slider') {
      slider = document.createElement('input');
      slider.type = 'range';
      slider.min = item.min; slider.max = item.max; slider.step = item.step;
      slider.value = String(numValue);
      row.appendChild(slider);
    }

    const setDisabled = (off) => {
      numBox.disabled = off;
      if (slider) slider.disabled = off;
      row.classList.toggle('disabled', off);
    };
    setDisabled(item.toggle && !enabled);

    const commit = () => {
      const v = clamp(parseFloat(numBox.value), item);
      numBox.value = String(v);
      if (slider) slider.value = String(v);
      if (item.toggle) patchParam(item.key, { enabled: check.checked, value: v });
      else patchParam(item.key, v);
    };

    if (slider) {
      slider.addEventListener('input', () => { numBox.value = slider.value; });
      slider.addEventListener('change', commit);
    }
    numBox.addEventListener('input', () => { if (slider) slider.value = numBox.value; });
    numBox.addEventListener('change', commit);
    if (check) {
      check.addEventListener('change', () => {
        setDisabled(!check.checked);
        patchParam(item.key, { enabled: check.checked, value: clamp(parseFloat(numBox.value), item) });
      });
    }

    return row;
  }

  function clamp(v, item) {
    if (Number.isNaN(v)) v = item.min;
    if (item.step >= 1) v = Math.round(v);
    return Math.min(item.max, Math.max(item.min, v));
  }

  function tagsControl(item, p) {
    const wrap = document.createElement('div');
    wrap.className = 'param-head';
    const lab = document.createElement('div');
    lab.className = 'param-label';
    lab.innerHTML = '<span>' + escapeHtml(t(item.label)) + '</span>';
    wrap.appendChild(lab);

    const box = document.createElement('div');
    box.className = 'tags';
    const stops = Array.isArray(p.stop) ? p.stop.slice() : [];

    function commit() { patchParam('stop', stops.slice()); render(); }
    function render() {
      box.innerHTML = '';
      stops.forEach((s, i) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = s;
        const x = document.createElement('button');
        x.textContent = '×'; x.title = t('Remove');
        x.addEventListener('click', () => { stops.splice(i, 1); commit(); });
        tag.appendChild(x);
        box.appendChild(tag);
      });
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = t('Type and press ⏎');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          e.preventDefault();
          stops.push(input.value.trim());
          commit();
        }
      });
      box.appendChild(input);
    }
    render();

    const outer = document.createElement('div');
    outer.appendChild(wrap);
    outer.appendChild(box);
    return outer;
  }

export { renderConfig, patchConfig, fieldRow };
