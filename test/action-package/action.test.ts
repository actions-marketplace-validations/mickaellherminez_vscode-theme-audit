// Runs only the shipped action and its licenses, copied away from this repository and node_modules.
// It catches missing bundled dependencies, workspace-relative imports and stale embedded versions.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EXTENSION, zip } from '../zip.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-action-package-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });
const artifact = join(temp, 'index.cjs');
copyFileSync(join(root, 'action/dist/index.cjs'), artifact);
copyFileSync(join(root, 'action/dist/LICENSES.txt'), join(temp, 'LICENSES.txt'));
cpSync(join(root, 'test/data/365'), join(temp, 'themes with spaces'), { recursive: true });
cpSync(join(root, 'test/data/oracle-extension'), join(temp, 'oracle'), { recursive: true });
copyFileSync(join(root, 'test/data/action/config.json'), join(temp, 'config.json'));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

function run(name: string, inputs: Record<string, string>) {
  const folder = join(temp, name);
  mkdirSync(folder);
  const summary = join(folder, 'summary.md');
  const output = join(folder, 'outputs');
  writeFileSync(summary, '');
  writeFileSync(output, '');
  const result = spawnSync(process.execPath, [artifact], {
    cwd: temp,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_PATH: '',
      GITHUB_WORKSPACE: temp,
      RUNNER_TEMP: folder,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
      INPUT_PATH: '.', INPUT_STRICT: 'false', INPUT_CONFIG: '',
      ...inputs,
    },
  });
  assert.equal(result.error, undefined);
  const markdown = readFileSync(summary, 'utf8');
  assert.ok(Buffer.byteLength(markdown) <= 60_000);
  const readable = markdown.replace(/&#([0-9]+);/g, (_: string, digits: string) => String.fromCodePoint(Number(digits)));
  return { ...result, markdown, readable, outputs: readFileSync(output, 'utf8') };
}

test('the shipped action audits a workspace without npm or the repository sources', () => {
  const result = run('pass', { INPUT_PATH: 'themes with spaces', INPUT_STRICT: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.markdown, /48 themes/);
  assert.match(result.markdown, /0 failures/);
  assert.ok(result.readable.includes(manifest.version));
  assert.match(result.readable, /1\.147\.0/);
});

test('the shipped action keeps failed checks, configured exceptions and its failure code', () => {
  const result = run('fail', { INPUT_PATH: 'oracle/themes/dark.json', INPUT_CONFIG: 'config.json' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.markdown, /Oracle Dark/);
  assert.match(result.markdown, /IGNORED/);
  assert.match(result.markdown, /This test fixture exercises a justified exception/);
});

test('the shipped action can extract a VSIX with its bundled dependencies', () => {
  writeFileSync(join(temp, 'night.vsix'), zip(EXTENSION));
  const result = run('vsix', { INPUT_PATH: 'night.vsix' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.readable, /night\.vsix/);
  assert.match(result.markdown, /Night/);
});

test('the shipped action reports fatal input errors in the summary', () => {
  const result = run('error', { INPUT_PATH: 'themes with spaces', INPUT_CONFIG: 'missing.json' });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.markdown, /missing\.json/);
});

test('the action includes the license notices of its bundled dependencies and ported code', () => {
  const licenses = readFileSync(join(temp, 'LICENSES.txt'), 'utf8');
  for (const name of ['jsonc-parser@', 'yauzl@', 'pend@', 'vscode-textmate', 'Visual Studio Code', 'xterm.js']) {
    assert.ok(licenses.includes(name), `Missing notice: ${name}`);
  }
});
