import * as vscode from 'vscode';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { ToolSchema } from './providers';

interface ServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

/** Cliente MCP mínimo sobre stdio (JSON-RPC 2.0 delimitado por saltos de línea). */
class McpClient {
  private proc?: ChildProcess;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  tools: McpTool[] = [];

  constructor(public readonly config: ServerConfig) {}

  async start(): Promise<void> {
    this.proc = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Windows: `npx`/`node` y otros son `.cmd`/`.bat`; sin shell, spawn da ENOENT.
      // El comando viene del .mcp del workspace (ya gateado por Workspace Trust).
      shell: process.platform === 'win32',
    });
    this.proc.stdout!.on('data', (d) => this.onData(d));
    this.proc.stderr!.on('data', () => {});
    this.proc.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('El servidor MCP terminó'));
      this.pending.clear();
    });
    this.proc.on('error', (e) => {
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'lang-chat', version: '0.1.0' },
    });
    this.notify('notifications/initialized', {});
    const list = await this.request('tools/list', {});
    this.tools = Array.isArray(list?.tools) ? list.tools : [];
  }

  private onData(d: Buffer): void {
    this.buffer += d.toString('utf8');
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? 'Error MCP'));
        else p.resolve(msg.result);
      }
      // Peticiones/notificaciones iniciadas por el servidor se ignoran en este MVP.
    }
  }

  private send(obj: any): void {
    // El proceso puede haber muerto: evita el TypeError de `stdin!` y degrada limpio.
    try { this.proc?.stdin?.write(JSON.stringify(obj) + '\n'); } catch { /* proceso muerto */ }
  }

  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout MCP: ${method}`));
        }
      }, 30000);
    });
  }

  private notify(method: string, params: any): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async callTool(name: string, args: any): Promise<string> {
    const res = await this.request('tools/call', { name, arguments: args ?? {} });
    const content = Array.isArray(res?.content) ? res.content : [];
    const text = content
      .map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c)))
      .join('\n');
    return text || '(sin salida)';
  }

  dispose(): void {
    // Rechaza lo pendiente de inmediato (no esperar al timeout de 30s) y cierra el proceso.
    for (const p of this.pending.values()) { try { p.reject(new Error('MCP cerrado')); } catch { /* noop */ } }
    this.pending.clear();
    try { this.proc?.stdin?.end(); } catch { /* noop */ }
    try { this.proc?.kill(); } catch { /* noop */ }
    this.proc = undefined;
  }
}

/** Lee las configuraciones de servidores MCP de `.mcp.json` y de `.mcp/*.json` del workspace. */
function loadServerConfigs(): ServerConfig[] {
  const out: ServerConfig[] = [];
  const add = (cfg: any) => {
    if (cfg && typeof cfg.command === 'string') {
      out.push({
        name: typeof cfg.name === 'string' ? cfg.name : cfg.command,
        command: cfg.command,
        args: Array.isArray(cfg.args) ? cfg.args : [],
        env: cfg.env && typeof cfg.env === 'object' ? cfg.env : undefined,
        cwd: typeof cfg.cwd === 'string' ? cfg.cwd : undefined,
      });
    }
  };
  const parse = (raw: string) => {
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    // Formato estándar { mcpServers: { nombre: cfg } }
    if (json && json.mcpServers && typeof json.mcpServers === 'object') {
      for (const [name, cfg] of Object.entries<any>(json.mcpServers)) add({ name, ...cfg });
    } else if (Array.isArray(json)) {
      json.forEach(add);
    } else {
      add(json); // un único servidor por archivo
    }
  };

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath;
    try {
      parse(fs.readFileSync(`${root}/.mcp.json`, 'utf8'));
    } catch {
      /* no existe */
    }
    try {
      for (const entry of fs.readdirSync(`${root}/.mcp`)) {
        if (entry.endsWith('.json')) {
          try {
            parse(fs.readFileSync(`${root}/.mcp/${entry}`, 'utf8'));
          } catch {
            /* archivo inválido */
          }
        }
      }
    } catch {
      /* no hay carpeta .mcp */
    }
  }
  return out;
}

/** Gestiona los servidores MCP y agrega sus tools (prefijadas por servidor: `servidor__tool`). */
export class McpManager {
  private clients: McpClient[] = [];
  private startPromise?: Promise<void>;
  errors: string[] = [];

  /** Arranca los servidores una sola vez (idempotente). */
  ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = (async () => {
        // Seguridad: no arrancar servidores MCP (spawn de comandos del .mcp del repo) en
        // un workspace no confiable — sería RCE al abrir un repo malicioso.
        if (!vscode.workspace.isTrusted) {
          this.errors.push('MCP deshabilitado: el workspace no es de confianza (Workspace Trust).');
          return;
        }
        for (const cfg of loadServerConfigs()) {
          const client = new McpClient(cfg);
          try {
            await client.start();
            this.clients.push(client);
          } catch (e: any) {
            this.errors.push(`${cfg.name}: ${e?.message ?? e}`);
          }
        }
      })();
    }
    return this.startPromise;
  }

  toolSchemas(): ToolSchema[] {
    const out: ToolSchema[] = [];
    for (const c of this.clients) {
      for (const t of c.tools) {
        out.push({
          name: `${c.config.name}__${t.name}`,
          description: t.description,
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
        });
      }
    }
    return out;
  }

  async call(fullName: string, args: any): Promise<string> {
    const sep = fullName.indexOf('__');
    const server = sep >= 0 ? fullName.slice(0, sep) : '';
    const tool = sep >= 0 ? fullName.slice(sep + 2) : fullName;
    const client = this.clients.find((c) => c.config.name === server);
    if (!client) throw new Error(`Servidor MCP no encontrado: ${server}`);
    return client.callTool(tool, args);
  }

  dispose(): void {
    this.clients.forEach((c) => c.dispose());
    this.clients = [];
    this.startPromise = undefined;
  }
}
