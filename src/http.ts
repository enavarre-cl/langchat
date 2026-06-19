import * as vscode from 'vscode';

// `fetch` that respects the configured proxy. Defaults to the global `fetch` (no changes in the
// common case, without proxy). If a proxy is set, routes through undici with a ProxyAgent —
// Node's global fetch does NOT respect proxies or VS Code's `http.proxy`, hence this wrapper.
let _fetch: typeof globalThis.fetch = globalThis.fetch;

/** Resolves the proxy from `http.proxy` (VS Code) or standard environment variables. */
function resolveProxy(): string {
  const cfg = vscode.workspace.getConfiguration('http').get<string>('proxy') || '';
  return (
    cfg ||
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy ||
    ''
  );
}

/** Configures the proxy once on activation. Idempotent; re-callable if the config changes. */
export function initProxy(): void {
  const proxy = resolveProxy();
  if (!proxy) { _fetch = globalThis.fetch; return; } // no proxy → always use global fetch
  try {
    const { fetch: undiciFetch, ProxyAgent } = require('undici');
    const strictSSL = vscode.workspace.getConfiguration('http').get<boolean>('proxyStrictSSL', true);
    const agent = new ProxyAgent(strictSSL ? proxy : { uri: proxy, requestTls: { rejectUnauthorized: false } });
    _fetch = ((input: any, init?: any) => undiciFetch(input, { ...(init || {}), dispatcher: agent })) as any;
  } catch {
    _fetch = globalThis.fetch; // undici unavailable or invalid proxy: fall back to global fetch
  }
}

/** `fetch` with proxy support. Use instead of the global `fetch`. */
export const httpFetch: typeof globalThis.fetch = (input: any, init?: any) => _fetch(input, init);
