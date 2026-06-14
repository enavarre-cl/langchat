import * as vscode from 'vscode';

// `fetch` que respeta el proxy configurado. Por defecto es el `fetch` global (cero cambios en el
// caso común, sin proxy). Si hay proxy, se enruta por undici con un ProxyAgent — el fetch global
// de Node NO respeta proxies ni `http.proxy` de VS Code, de ahí este wrapper.
let _fetch: typeof globalThis.fetch = globalThis.fetch;

/** Resuelve el proxy de `http.proxy` (VS Code) o las variables de entorno estándar. */
function resolveProxy(): string {
  const cfg = vscode.workspace.getConfiguration('http').get<string>('proxy') || '';
  return (
    cfg ||
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy ||
    ''
  );
}

/** Configura el proxy una vez al activar. Idempotente; re-llamable si cambia la config. */
export function initProxy(): void {
  const proxy = resolveProxy();
  if (!proxy) { _fetch = globalThis.fetch; return; } // sin proxy → fetch global de siempre
  try {
    const { fetch: undiciFetch, ProxyAgent } = require('undici');
    const strictSSL = vscode.workspace.getConfiguration('http').get<boolean>('proxyStrictSSL', true);
    const agent = new ProxyAgent(strictSSL ? proxy : { uri: proxy, requestTls: { rejectUnauthorized: false } });
    _fetch = ((input: any, init?: any) => undiciFetch(input, { ...(init || {}), dispatcher: agent })) as any;
  } catch {
    _fetch = globalThis.fetch; // undici no disponible o proxy inválido: degrada al fetch global
  }
}

/** `fetch` con soporte de proxy. Úsalo en lugar del `fetch` global. */
export const httpFetch: typeof globalThis.fetch = (input: any, init?: any) => _fetch(input, init);
