// Assertions for the live GitHub Action workflow, including the failures it deliberately exercises.
// Inputs come through environment variables rather than interpolated JavaScript or shell commands.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function report(prefix: string, outcome: string, code: string): string {
  assert.equal(process.env[`${prefix}_OUTCOME`], outcome);
  assert.equal(process.env[`${prefix}_CODE`], code);
  const path = process.env[`${prefix}_REPORT`];
  assert.ok(path, `${prefix} did not save a report`);
  const markdown = readFileSync(path, 'utf8');
  assert.ok(Buffer.byteLength(markdown) <= 60_000);
  assert.match(markdown, /^# vscode-theme-audit/);
  return markdown;
}

const passing = report('PASS', 'success', '0');
assert.match(passing, /48 themes/);
assert.match(passing, /0 failures/);
assert.match(passing, /Mode: strict/);

const failing = report('FAIL', 'failure', '1');
assert.match(failing, /Oracle Dark/);
assert.match(failing, /IGNORED/);
assert.match(failing, /This test fixture exercises a justified exception/);

const error = report('ERROR', 'failure', '2');
assert.match(error, /missing/);
process.stdout.write('The action passed, reported failed checks, and reported a configuration error as expected.\n');
