// The corpus: each extension of extensions.json, downloaded by scripts/corpus.ts, is extracted as VS Code installs
// it and audited in both modes without a crash, with a report that its schema accepts, and gives the themes and
// warnings of expected.json, from the extracted folder and from the .vsix itself. One extension is also downloaded
// from Open VSX by its id. `npm run test:corpus` runs it after the download; `npm test` does not, since it needs
// the network.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { after, test } from 'node:test';

import { packageVersion } from '../../src/main.ts';
import { auditInputs, auditPaths } from '../../src/report.ts';
import type { Report } from '../../src/report.ts';
import { schemaErrors, validateReport } from '../report-schema.ts';
import { extensionResult, extractVsix, readExpected, readList, sha256, vsixPath } from './corpus.ts';

const { extensions } = readList();
const expected = readExpected();
const version = packageVersion();

const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-corpus-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });

test('expected.json gives the extensions of extensions.json, at the same versions', () => {
  assert.deepEqual(expected.map((e) => `${e.id}@${e.version}`), extensions.map((e) => `${e.id}@${e.version}`));
});

for (const extension of extensions) {
  const themes = expected.find((e) => e.id === extension.id)?.themes.length ?? 0;
  test(`${extension.id} ${extension.version}: ${String(themes)} theme${themes === 1 ? '' : 's'}`, async () => {
    const vsix = vsixPath(extension);
    assert.ok(existsSync(vsix), `${relative(process.cwd(), vsix)} is missing: run npm run corpus`);
    assert.equal(sha256(readFileSync(vsix)), extension.sha256, `${relative(process.cwd(), vsix)} changed: run npm run corpus to download it again`);
    const folder = join(temp, extension.id);
    await extractVsix(vsix, folder);
    for (const strict of [false, true]) {
      const report = auditPaths(['.'], { strict, version, cwd: folder });
      assert.ok(validateReport(report), schemaErrors());
      assert.deepEqual(extensionResult(extension, report), expected.find((e) => e.id === extension.id));
    }
    // The .vsix itself, without extracting it first: the same themes and warnings, named inside the .vsix
    const report = await auditInputs([basename(vsix)], { version, cwd: dirname(vsix) });
    assert.ok(validateReport(report), schemaErrors());
    assert.deepEqual(extensionResult(extension, inside(report, `${basename(vsix)}/extension/`)), expected.find((e) => e.id === extension.id));
  });
}

/** A report of a .vsix with the paths of its extension folder, as for the extracted folder. */
function inside(report: Report, prefix: string): Report {
  const strip = (text: string) => text.split(prefix).join('');
  return {
    ...report,
    warnings: report.warnings.map(strip),
    themes: report.themes.map((theme) => ({ ...theme, file: strip(theme.file), warnings: theme.warnings.map(strip) })),
  };
}

test('an extension downloaded from Open VSX by its id: the same as its .vsix of the corpus', async () => {
  const extension = extensions.find((e) => e.id === 'sdras.night-owl');
  assert.ok(extension);
  const id = `open-vsx:${extension.id}@${extension.version}`;
  const report = await auditInputs([id], { version });
  assert.ok(validateReport(report), schemaErrors());
  assert.deepEqual(extensionResult(extension, inside(report, `${id}/extension/`)), expected.find((e) => e.id === extension.id));
});
