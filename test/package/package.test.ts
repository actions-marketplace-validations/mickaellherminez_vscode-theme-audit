// The content of the package published to npm, as `npm pack --dry-run` lists it: the compiled code, its types, the
// JSON schema of the report and the documents, nothing else, under a size limit. It needs dist/, so it runs after
// the build: `npm run test:package` (which builds first), and at the end of `npm run check`.

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

interface PackResult { size: number; unpackedSize: number; files: { path: string; size: number }[] }

/** The largest package accepted, compressed and unpacked, in bytes: about 1.5 times the size of 0.1.1. */
const MAX_SIZE = 120_000;
const MAX_UNPACKED_SIZE = 500_000;

const ROOT = new URL('../../', import.meta.url);
// execSync runs a shell, which finds npm on every system (npm.cmd on Windows)
const [pack] = JSON.parse(execSync('npm pack --dry-run --json --ignore-scripts', { cwd: ROOT, encoding: 'utf8' })) as PackResult[];
if (!pack) throw new Error('npm pack gave no result');
const files = pack.files.map((file) => file.path).sort();

test('the package contains the compiled code, the schemas and the documents only', () => {
  const documents = ['CHANGELOG.md', 'LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'package.json', 'schema/config-v1.schema.json', 'schema/report-v1.schema.json'];
  const sources = readdirSync(new URL('src/', ROOT)).filter((name) => name.endsWith('.ts')).map((name) => name.slice(0, -'.ts'.length));
  const compiled = sources.flatMap((name) => [`dist/${name}.d.ts`, `dist/${name}.js`]);
  assert.deepEqual(files, [...documents, ...compiled].sort());
});

test('the command of the package is compiled and runs with Node.js', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as { bin: Record<string, string>; exports: string; types: string };
  for (const path of [...Object.values(manifest.bin), manifest.exports, manifest.types]) {
    assert.ok(files.includes(path.replace(/^\.\//, '')), `${path} is not in the package`);
  }
  const cli = readFileSync(new URL(manifest.bin['vscode-theme-audit'] ?? '', ROOT), 'utf8');
  assert.ok(cli.startsWith('#!/usr/bin/env node\n'), 'the command starts with #!/usr/bin/env node');
});

test(`the package stays under ${String(MAX_SIZE / 1000)} kB, and ${String(MAX_UNPACKED_SIZE / 1000)} kB unpacked`, () => {
  assert.ok(pack.size <= MAX_SIZE, `${String(pack.size)} bytes`);
  assert.ok(pack.unpackedSize <= MAX_UNPACKED_SIZE, `${String(pack.unpackedSize)} bytes unpacked`);
});
