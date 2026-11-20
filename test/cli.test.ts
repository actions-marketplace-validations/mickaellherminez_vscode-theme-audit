import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { HELP, main, packageVersion } from '../src/main.ts';

function run(args: string[]) {
  let out = '';
  let err = '';
  const code = main(args, { out: (text) => { out += text; }, err: (text) => { err += text; } });
  return { code, out, err };
}

test('the version is the one of package.json', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(packageVersion(), manifest.version);
  for (const flag of ['-v', '--version']) {
    assert.deepEqual(run([flag]), { code: 0, out: `${manifest.version}\n`, err: '' });
  }
});

test('the help is printed on demand, and on a usage error', () => {
  assert.deepEqual(run(['--help']), { code: 0, out: HELP, err: '' });
  assert.deepEqual(run([]), { code: 2, out: '', err: HELP });
  const unknown = run(['--colors']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /^Unknown option: --colors\n/);
});

test('a theme cannot be audited yet, and the command says so', () => {
  const result = run(['theme.json']);
  assert.equal(result.code, 2);
  assert.match(result.err, /not available yet/);
});

test('the command runs from its source file', () => {
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${packageVersion()}\n`);
});
