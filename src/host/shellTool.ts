/**
 * Executor for the `run_command` tool: spawns a shell command in the workspace root, captures
 * stdout+stderr, enforces a timeout + the turn's Stop signal, and caps output. This is arbitrary
 * code execution, so the host gates it hard: trusted workspace + the `jotflow.tools.shell` opt-in
 * (off by default) + a per-command modal confirmation unless `jotflow.tools.shellAutoApprove`.
 */
import { spawn } from 'child_process';
import { killProcessTree } from './procKill';

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 100_000; // chars

/** Pure: caps combined output with a clear truncation marker. */
export function capOutput(out: string, max = MAX_OUTPUT): string {
  return out.length > max ? out.slice(0, max) + `\n… (output truncated at ${max} chars)` : out;
}

/** Runs `command` via the shell in `cwd`, returning stdout+stderr plus the exit status. */
export function runShellCommand(command: string, cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve) => {
    const proc = spawn(command, { cwd, shell: true, env: process.env });
    let out = '';
    let ended = false;
    const append = (d: Buffer): void => { if (out.length < MAX_OUTPUT) out += d.toString('utf8'); }; // bound memory
    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);
    const finish = (tail: string): void => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(capOutput(out) + tail);
    };
    const onAbort = (): void => { killProcessTree(proc); finish('\n(stopped)'); };
    const timer = setTimeout(() => { killProcessTree(proc); finish(`\n(timed out after ${TIMEOUT_MS / 1000}s)`); }, TIMEOUT_MS);
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort); }
    proc.on('error', (e) => finish(`\n(failed to run: ${e.message})`));
    proc.on('close', (code) => finish(`\n(exit code ${code ?? 'null'})`));
  });
}
