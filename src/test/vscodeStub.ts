// Test-only stub for the `vscode` module. Several production modules (e.g. providers/index,
// spellWords) `import * as vscode`, which is unavailable outside the extension host. Importing this
// file FIRST registers a minimal in-memory mock so those modules can be required from node:test.
import Module from 'node:module';

interface LoaderModule { _load(request: string, parent: unknown, isMain: boolean): unknown }
const M = Module as unknown as LoaderModule;
const originalLoad = M._load.bind(M);

const stub: Record<string, unknown> = {
  EventEmitter: class { event = (): void => {}; fire = (): void => {}; dispose = (): void => {}; },
  Uri: { joinPath: (...parts: unknown[]) => ({ path: parts.join('/') }) },
  workspace: { fs: {} },
  window: {},
  commands: {},
};

M._load = (request: string, parent: unknown, isMain: boolean): unknown => {
  if (request === 'vscode') return stub;
  return originalLoad(request, parent, isMain);
};
