/** Ollama server model management (API /api/*). Uses httpFetch (proxy/SSRF covered). */
import { httpFetch } from '../http';
import { readLines } from '../providers/stream';

export interface LocalModel {
  name: string;
  size: number;        // bytes
  parameterSize?: string;
  quantization?: string;
  family?: string;
  modified?: string;
}

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
}

export interface PullProgress {
  status: string;
  total?: number;
  completed?: number;
}

const base = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

/** Lists local models (GET /api/tags). */
export async function listLocal(baseUrl: string): Promise<LocalModel[]> {
  const res = await httpFetch(`${base(baseUrl)}/api/tags`);
  if (!res.ok) throw new Error(`/api/tags HTTP ${res.status}`);
  const json: any = await res.json();
  return (json?.models || []).map((m: any): LocalModel => ({
    name: m.name,
    size: m.size || 0,
    parameterSize: m.details?.parameter_size,
    quantization: m.details?.quantization_level,
    family: m.details?.family,
    modified: m.modified_at,
  }));
}

/** Model detail (POST /api/show); includes real capabilities (D3: truth after download). */
export async function show(baseUrl: string, name: string): Promise<{ capabilities: ModelCapabilities; raw: any }> {
  const res = await httpFetch(`${base(baseUrl)}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`/api/show HTTP ${res.status}`);
  const json: any = await res.json();
  const caps: string[] = Array.isArray(json?.capabilities) ? json.capabilities : [];
  return {
    raw: json,
    capabilities: {
      vision: caps.includes('vision'),
      tools: caps.includes('tools'),
      reasoning: caps.includes('thinking') || caps.includes('reasoning'),
    },
  };
}

/** Deletes a local model (DELETE /api/delete). */
export async function remove(baseUrl: string, name: string): Promise<void> {
  const res = await httpFetch(`${base(baseUrl)}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`/api/delete HTTP ${res.status}`);
}

/**
 * Downloads a model (POST /api/pull, streaming NDJSON).
 * `ref` can be `model:tag` (Ollama registry) or `hf.co/user/repo:quant` (Hugging Face).
 */
export async function pull(
  baseUrl: string,
  ref: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await httpFetch(`${base(baseUrl)}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ref, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`/api/pull HTTP ${res.status}`);
  const reader = res.body.getReader();
  // Aborting the fetch does not always cut the Ollama stream reader; we force-cancel it.
  const onAbort = () => { void reader.cancel().catch(() => { /* ignore */ }); };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    await readLines(reader, (line) => {
      if (!line) return;
      let json: any;
      try { json = JSON.parse(line); } catch { return; }
      if (json?.error) throw new Error(String(json.error));
      onProgress({ status: json.status || '', total: json.total, completed: json.completed });
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
