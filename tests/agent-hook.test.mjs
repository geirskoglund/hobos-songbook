import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const hook = join(root, '.claude', 'hooks', 'format-edited.mjs');
const run = (script, file_path) =>
  spawnSync(process.execPath, [script], {
    input: JSON.stringify({tool_name: 'Edit', tool_input: {file_path}}),
    encoding: 'utf8',
    timeout: 60_000,
  });

test('agent hook reports lint errors in the edited file without stopping the edit', () => {
  const name = `hook-probe-${process.pid}.mjs`;
  const probe = join(root, 'tests', name);
  writeFileSync(probe, 'debugger;\n');
  try {
    const result = run(hook, probe);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, 'PostToolUse');
    assert.match(output.additionalContext, new RegExp(`ESLint fant feil i tests.${name}`));
    assert.match(output.additionalContext, /no-debugger/);
  } finally {
    rmSync(probe, {force: true});
  }
});

test('agent hook is silent for a clean file', () => {
  const result = run(hook, join(root, 'tests', 'agent-hook.test.mjs'));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('agent hook is silent when ESLint and Prettier are missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hook-'));
  try {
    const hooks = join(dir, '.claude', 'hooks');
    mkdirSync(hooks, {recursive: true});
    copyFileSync(hook, join(hooks, 'format-edited.mjs'));
    const file = join(dir, 'probe.mjs');
    writeFileSync(file, 'debugger;\n');
    const result = run(join(hooks, 'format-edited.mjs'), file);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
