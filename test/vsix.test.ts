import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { auditInputs, auditPaths } from '../src/report.ts';
import { ThemeError } from '../src/theme.ts';
import { extractVsix } from '../src/vsix.ts';
import { EXTENSION, zip } from './zip.ts';

const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-vsix-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });

function write(name: string, entries: Record<string, string>): string {
  const file = join(temp, name);
  writeFileSync(file, zip(entries));
  return file;
}

describe('extracting a .vsix', () => {
  test('the files under extension/ are extracted without this prefix, as VS Code installs them', async () => {
    const target = join(temp, 'extracted');
    await extractVsix(write('night-1.0.0.vsix', EXTENSION), target);
    assert.equal(readFileSync(join(target, 'package.json'), 'utf8'), EXTENSION['extension/package.json']);
    assert.ok(existsSync(join(target, 'themes', 'night.json')));
    // extension.vsixmanifest starts with "extension", as in VS Code
    assert.ok(existsSync(join(target, '.vsixmanifest')));
  });

  test('a file that is not a zip is a ThemeError', async () => {
    const file = join(temp, 'broken.vsix');
    writeFileSync(file, 'not a zip');
    await assert.rejects(extractVsix(file, join(temp, 'broken')), (error: unknown) => error instanceof ThemeError && /not a \.vsix file/.test(error.message));
  });

  test('an entry outside the folder is refused', async () => {
    const file = write('escape.vsix', { 'extension/../../escaped.txt': 'x' });
    await assert.rejects(extractVsix(file, join(temp, 'escape')), ThemeError);
    assert.ok(!existsSync(join(temp, 'escaped.txt')));
  });

  test('more entries, or more bytes, than the limits are refused', async () => {
    const file = write('large.vsix', { 'extension/a.txt': 'x'.repeat(100), 'extension/b.txt': 'y'.repeat(100) });
    await assert.rejects(extractVsix(file, join(temp, 'many'), { entries: 1, bytes: 1_000 }), /more than 1 entries/);
    await assert.rejects(extractVsix(file, join(temp, 'big'), { entries: 10, bytes: 150 }), /files take more than/);
    await extractVsix(file, join(temp, 'fits'), { entries: 10, bytes: 200 });
  });
});

describe('auditing a .vsix', () => {
  test('gives the audit of the extracted extension, with the paths inside the .vsix', async () => {
    write('night-1.0.0.vsix', EXTENSION);
    const folder = join(temp, 'folder');
    await extractVsix(join(temp, 'night-1.0.0.vsix'), folder);
    const fromVsix = await auditInputs(['night-1.0.0.vsix'], { version: 'test', cwd: temp });
    const fromFolder = auditPaths(['folder'], { version: 'test', cwd: temp });
    assert.equal(fromVsix.themes[0]?.file, 'night-1.0.0.vsix/extension/themes/night.json');
    // The same audit: only the paths differ
    const withoutFile = (report: typeof fromVsix) => report.themes.map((theme) => ({ ...theme, file: '' }));
    assert.deepEqual(withoutFile(fromVsix), withoutFile(fromFolder));
    assert.deepEqual(fromVsix.summary, fromFolder.summary);
  });

  test('the temporary folder is deleted, and a broken .vsix stops the audit like a missing path', async () => {
    // A temporary folder of its own: the other test files run at the same time, and use the system one too.
    // os.tmpdir() reads these variables at each call, and each test file runs in a process of its own
    const own = mkdtempSync(join(temp, 'own-temp-'));
    const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    Object.assign(process.env, { TMPDIR: own, TMP: own, TEMP: own });
    try {
      assert.equal(tmpdir(), own);
      await auditInputs(['night-1.0.0.vsix'], { version: 'test', cwd: temp });
      assert.deepEqual(readdirSync(own), []);
      await assert.rejects(auditInputs(['broken.vsix'], { version: 'test', cwd: temp }), ThemeError);
      assert.deepEqual(readdirSync(own), []);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    }
  });
});
