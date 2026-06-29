import './vscodeStub'; // must come first: importing ../mcp pulls in `vscode` at module load
import { test } from 'node:test';
import assert from 'node:assert';
import { computeRoots } from '../mcp';

test('computeRoots maps workspace folders to file:// roots', () => {
  const roots = computeRoots([{ fsPath: '/work/proj', name: 'proj' }]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].name, 'proj');
  assert.ok(roots[0].uri.startsWith('file://'));
  assert.ok(roots[0].uri.endsWith('/work/proj'));
});

test('computeRoots adds the server cwd as an extra root', () => {
  const roots = computeRoots([{ fsPath: '/work/proj', name: 'proj' }], '/srv/run');
  assert.equal(roots.length, 2);
  assert.ok(roots.some((r) => r.name === 'run' && r.uri.endsWith('/srv/run')));
});

test('computeRoots dedupes when cwd equals a workspace folder', () => {
  const roots = computeRoots([{ fsPath: '/work/proj', name: 'proj' }], '/work/proj');
  assert.equal(roots.length, 1);
});

test('computeRoots supports multiple workspace folders', () => {
  const roots = computeRoots([
    { fsPath: '/a', name: 'a' },
    { fsPath: '/b', name: 'b' },
  ]);
  assert.deepEqual(roots.map((r) => r.name).sort(), ['a', 'b']);
});

test('computeRoots with no folders and no cwd is empty', () => {
  assert.deepEqual(computeRoots([]), []);
});
