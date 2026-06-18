import * as vscode from 'vscode';
import * as path from 'path';
import { parseDoc } from './chatDocument';
import { chatDefaults } from './providers';
import { tr } from './i18n';

/**
 * Comparación de versiones de un .chat como DOS columnas de chat renderizado (pasado | actual).
 * Se dispara desde el menú contextual de un ítem del Timeline (Local History) o desde la paleta.
 *
 * Nota: el argumento que pasa `timeline/item/context` para Local History está poco documentado;
 * la extracción de URIs es defensiva (prueba varias formas) y cae a un selector de archivo.
 */

/** Lee y parsea un .chat desde una URI (tolera esquemas de content-provider como Local History). */
async function readChat(uri: vscode.Uri): Promise<{ title: string; messages: any[] } | null> {
  try {
    const docu = await vscode.workspace.openTextDocument(uri);
    const doc = parseDoc(docu.getText(), chatDefaults());
    return { title: doc.title, messages: doc.messages.filter((m) => m.role !== 'system') };
  } catch {
    return null;
  }
}

/** Reúne URIs candidatas escondidas en el argumento del ítem del Timeline. */
function collectUris(arg: any): vscode.Uri[] {
  const out: vscode.Uri[] = [];
  const add = (v: any) => {
    if (!v) return;
    if (v instanceof vscode.Uri) { out.push(v); return; }
    if (typeof v === 'object' && typeof v.scheme === 'string' && typeof v.path === 'string') {
      try { out.push(vscode.Uri.from(v)); } catch { /* no era una URI */ }
    }
  };
  if (arg?.command?.arguments && Array.isArray(arg.command.arguments)) arg.command.arguments.forEach(add);
  add(arg?.uri);
  add(arg);
  return out;
}

export function registerCompare(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand('langChat.compareVersion', async (arg: any) => {
    // 1) Resolver versión "pasada" y "actual".
    let pastUri: vscode.Uri | undefined;
    let currentUri: vscode.Uri | undefined;

    const uris = collectUris(arg);
    const active = vscode.window.activeTextEditor?.document.uri
      ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const activeUri = active instanceof vscode.Uri ? active : (active as any)?.uri;

    if (uris.length >= 2) {
      // El comando de diff del Timeline suele ser vscode.diff(original, modificado).
      pastUri = uris[0];
      currentUri = uris[1];
    } else if (uris.length === 1) {
      pastUri = uris[0];
      currentUri = activeUri;
    }

    // 2) Si no hay versión pasada, ofrecer un selector de archivo (camino garantizado).
    if (!pastUri) {
      const picked = await vscode.window.showOpenDialog({
        title: tr('Pick a .chat version to compare'),
        filters: { 'Lang Chat': ['chat'] },
        canSelectMany: false,
      });
      if (!picked || !picked.length) return;
      pastUri = picked[0];
      currentUri = currentUri ?? activeUri;
    }
    if (!currentUri) currentUri = activeUri;
    if (!currentUri) {
      vscode.window.showErrorMessage(tr('Open the .chat first to compare it.'));
      return;
    }

    const past = await readChat(pastUri);
    const current = await readChat(currentUri);
    if (!past || !current) {
      vscode.window.showErrorMessage(tr('Could not read one of the .chat versions.'));
      return;
    }

    // 3) Abrir el webview de dos columnas.
    const name = path.basename(currentUri.fsPath);
    const panel = vscode.window.createWebviewPanel(
      'langChat.compare',
      tr('Compare: ') + name,
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] }
    );
    const media = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', f));
    const nonce = String(Date.now()) + Math.random().toString(36).slice(2);
    const csp = [
      `default-src 'none'`,
      `img-src ${panel.webview.cspSource} data: blob:`,
      `style-src ${panel.webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    panel.webview.html = `<!DOCTYPE html>
<html lang="${vscode.env.language.startsWith('es') ? 'es' : 'en'}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link href="${media('compare.css')}" rel="stylesheet" />
  <title>${tr('Compare')}</title>
</head>
<body>
  <div id="cols">
    <section class="col"><header id="pastLabel"></header><div id="pastBody" class="msgs"></div></section>
    <section class="col"><header id="curLabel"></header><div id="curBody" class="msgs"></div></section>
  </div>
  <script nonce="${nonce}" src="${media('compare.js')}"></script>
</body>
</html>`;

    panel.webview.onDidReceiveMessage((m) => {
      if (m?.type === 'ready') {
        panel.webview.postMessage({
          type: 'render',
          past: { label: tr('Past version'), ...past },
          current: { label: tr('Current version'), ...current },
        });
      }
    });

    context.subscriptions.push(panel);
  });
  context.subscriptions.push(cmd);
}
