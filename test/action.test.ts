// The action writes its job summary before it fails, and treats inputs as data rather than shell commands.

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runAction } from '../action/run.ts';
import { CONFIG_FILE } from '../src/config.ts';
import { EXTENSION, zip } from './zip.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-action-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });
let count = 0;

async function run(env: Readonly<Record<string, string | undefined>> = {}, prefix = '') {
  const summaryFile = join(temp, `summary-${String(++count)}.md`);
  const outputsFile = join(temp, `outputs-${String(count)}.txt`);
  writeFileSync(summaryFile, prefix);
  writeFileSync(outputsFile, '');
  let out = '';
  let err = '';
  const actionEnv = { GITHUB_WORKSPACE: ROOT, GITHUB_STEP_SUMMARY: summaryFile, GITHUB_OUTPUT: outputsFile, RUNNER_TEMP: temp, ...env };
  const code = await runAction({
    version: 'action-test',
    env: actionEnv,
    output: { out: (text) => { out += text; }, err: (text) => { err += text; } },
  });
  const outputs = readFileSync(outputsFile, 'utf8');
  const report = /^report-path<<([^\n]+)\n([^\n]+)\n\1\nexit-code=(\d)\n$/.exec(outputs);
  const reportPath = report?.[2];
  if (reportPath !== undefined) {
    if (actionEnv.GITHUB_STEP_SUMMARY === summaryFile) assert.equal(readFileSync(reportPath, 'utf8'), readFileSync(summaryFile, 'utf8').slice(prefix.length));
    assert.equal(Number(report?.[3]), code);
  }
  return { code, out, err, outputs, reportPath, summary: readFileSync(summaryFile, 'utf8') };
}

function failures(output: string): number {
  const match = /, (\d+) failures,/.exec(output);
  assert.ok(match?.[1], output);
  return Number(match[1]);
}

test('the default path audits the workspace, writes the strict report and returns success', async () => {
  const result = await run({ GITHUB_WORKSPACE: join(ROOT, 'test', 'data', '365'), INPUT_STRICT: 'true' }, 'Existing summary\n\n');
  assert.equal(result.code, 0);
  assert.equal(result.err, '');
  assert.equal(result.out, 'vscode-theme-audit: 48 themes, 0 failures, 0 unreadable. See the job summary.\n');
  assert.ok(result.summary.startsWith('Existing summary\n\n# vscode-theme-audit'));
  assert.match(result.summary, /action(?:-|&#45;)test/);
  assert.ok(result.reportPath);
  assert.match(result.summary, /strict/i);
  assert.match(result.summary, /365/);
});

test('a failed audit still writes its Markdown summary before returning failure', async () => {
  const result = await run({ INPUT_PATH: 'test/data/oracle-extension/themes/dark.json' });
  assert.equal(result.code, 1);
  assert.equal(result.err, '');
  assert.ok(failures(result.out) > 0);
  assert.ok(result.reportPath);
  assert.match(result.summary, /Oracle Dark/);
  assert.match(result.summary, /Line numbers/);
});

test('strict changes the audit, instead of merely changing the report heading', async () => {
  const general = await run({ INPUT_PATH: 'test/data/oracle-extension/themes/dark.json' });
  const strict = await run({ INPUT_PATH: 'test/data/oracle-extension/themes/dark.json', INPUT_STRICT: 'true' });
  assert.equal(strict.code, 1);
  assert.equal(strict.err, '');
  assert.ok(failures(strict.out) > failures(general.out));
  assert.match(strict.summary, /Required key/);
});

test('a configuration input is resolved from the workspace and keeps ignored reasons visible', async () => {
  const folder = join(temp, 'configuration');
  mkdirSync(folder);
  cpSync(join(ROOT, 'test', 'data', 'oracle-extension'), join(folder, 'extension'), { recursive: true });
  writeFileSync(join(folder, 'audit.json'), JSON.stringify({ ignore: [{ check: 'Line numbers', reason: 'Dimmed on purpose' }] }));
  const general = await run({ GITHUB_WORKSPACE: folder, INPUT_PATH: 'extension/themes/dark.json' });
  const configured = await run({ GITHUB_WORKSPACE: folder, INPUT_PATH: 'extension/themes/dark.json', INPUT_CONFIG: 'audit.json' });
  assert.equal(configured.code, 1);
  assert.equal(configured.err, '');
  assert.equal(failures(configured.out), failures(general.out) - 1);
  assert.match(configured.summary, /IGNORED/);
  assert.match(configured.summary, /Dimmed on purpose/);
  assert.match(configured.summary, /audit(?:\.|&#46;)json/);
});

test('an empty configuration input finds the configuration of the extension', async () => {
  const folder = join(temp, 'automatic-configuration');
  cpSync(join(ROOT, 'test', 'data', 'oracle-extension'), folder, { recursive: true });
  writeFileSync(join(folder, CONFIG_FILE), JSON.stringify({ ignore: [{ check: 'Line numbers', reason: 'Automatic configuration' }] }));
  const result = await run({ GITHUB_WORKSPACE: folder, INPUT_PATH: 'themes/dark.json', INPUT_CONFIG: '' });
  assert.equal(result.code, 1);
  assert.equal(result.err, '');
  assert.match(result.summary, /Automatic configuration/);
});

test('strict accepts true or false only, and reports invalid values in the summary', async () => {
  for (const value of ['yes', 'TRUE', ' true ', '']) {
    const result = await run({ INPUT_STRICT: value, INPUT_PATH: 'missing.json' });
    assert.equal(result.code, 2);
    assert.equal(result.out, '');
    assert.match(result.err, /strict input must be true or false/);
    assert.match(result.summary, /\*\*ERROR:\*\*/);
    assert.match(result.summary, /strict input must be true or false/);
  }
});

test('an invalid configuration fails with an error in the summary', async () => {
  const file = join(temp, 'invalid-configuration.json');
  writeFileSync(file, JSON.stringify({ thresholds: { text: 0 } }));
  const result = await run({ INPUT_PATH: 'test/data/365', INPUT_CONFIG: file });
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.err, /invalid configuration/);
  assert.ok(result.reportPath);
  assert.match(result.summary, /invalid configuration/);
});

test('a missing path cannot inject HTML, mentions or workflow commands through the error', async () => {
  const result = await run({ INPUT_PATH: 'missing-<script>@owner\n::warning::injected.json' });
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.err, /no such file or folder/);
  assert.equal(result.err.split('\n').length, 2);
  assert.equal(result.summary.includes('<script>'), false);
  assert.equal(result.summary.includes('@owner'), false);
  assert.match(result.summary, /&lt;script&gt;&#64;owner/);
});

test('an unreadable theme is kept in the report, with exit code 2', async () => {
  const file = join(temp, 'broken.json');
  writeFileSync(file, '{ "colors": {');
  const result = await run({ INPUT_PATH: file });
  assert.equal(result.code, 2);
  assert.equal(result.err, '');
  assert.match(result.out, /1 unreadable/);
  assert.match(result.summary, /VS Code cannot parse this JSON/);
});

test('paths with spaces and shell syntax are one literal input', async () => {
  const folder = join(temp, 'literal $(echo untouched) theme');
  cpSync(join(ROOT, 'test', 'data', 'oracle-extension'), folder, { recursive: true });
  const result = await run({ INPUT_PATH: folder });
  assert.equal(result.code, 1);
  assert.equal(result.err, '');
  assert.match(result.out, /^vscode-theme-audit: 4 themes,/);
  assert.match(result.summary, /Oracle Dark/);
});

test('the path input accepts a packaged extension without running anything from it', async () => {
  const file = join(temp, 'packaged theme.vsix');
  writeFileSync(file, zip(EXTENSION));
  const result = await run({ INPUT_PATH: file });
  assert.equal(result.code, 1);
  assert.equal(result.err, '');
  assert.match(result.out, /^vscode-theme-audit: 1 themes,/);
  assert.match(result.summary, /Night/);
});

test('a missing or unwritable summary fails instead of reporting success without a report', async () => {
  const absent = await run({ GITHUB_STEP_SUMMARY: undefined });
  assert.equal(absent.code, 2);
  assert.match(absent.err, /GITHUB_STEP_SUMMARY is required/);
  assert.equal(absent.summary, '');
  const directory = await run({ INPUT_PATH: 'test/data/365', GITHUB_STEP_SUMMARY: temp });
  assert.equal(directory.code, 2);
  assert.match(directory.err, /could not write the job summary/);
  assert.ok(existsSync(temp));
});
