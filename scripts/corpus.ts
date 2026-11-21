// Downloads the corpus of the tests from Open VSX into .cache/corpus/, which is not committed, and checks the
// SHA-256 of each .vsix against test/corpus/extensions.json. `npm run test:corpus` runs it before the corpus test.
//
//   node scripts/corpus.ts                          Download the .vsix files that the cache lacks
//   node scripts/corpus.ts --update <id>@<version>  Move one extension to another version: download it, check its
//                                                   SHA-256 against the one that Open VSX publishes, write the version
//                                                   and the SHA-256 in extensions.json, then write expected.json again
//   node scripts/corpus.ts --expected               Write test/corpus/expected.json again, after a change of the
//                                                   package that changes the themes or the warnings on purpose

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { auditPaths } from '../src/report.ts';
import {
  CACHE, EXPECTED, download, extensionResult, extractVsix, fetchFile, openVsxUrl, readList, saveVsix, sha256, vsixPath,
  writeExpected, writeList,
} from '../test/corpus/corpus.ts';
import type { CorpusExtension, ExtensionResult } from '../test/corpus/corpus.ts';

const USAGE = 'Usage: node scripts/corpus.ts [--update <publisher.name>@<version>] [--expected]\n';

let options: { update?: string; expected?: boolean };
try {
  options = parseArgs({ options: { update: { type: 'string' }, expected: { type: 'boolean' } } }).values;
} catch (error) {
  process.stderr.write(`corpus: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  process.exit(2);
}

function display(path: string): string {
  return relative(process.cwd(), path) || path;
}

async function downloadAll(extensions: readonly CorpusExtension[]): Promise<void> {
  let downloaded = 0;
  for (const extension of extensions) {
    if (await download(extension)) {
      downloaded++;
      console.log(`downloaded ${extension.id} ${extension.version}`);
    }
  }
  console.log(`${String(extensions.length)} extensions in ${display(CACHE)}: ${String(downloaded)} downloaded, ${String(extensions.length - downloaded)} already there`);
}

/** Moves an extension of the list to another version, checked against the SHA-256 that Open VSX publishes. */
async function update(spec: string): Promise<void> {
  const at = spec.lastIndexOf('@');
  if (at <= 0 || at === spec.length - 1) throw new Error(`--update ${spec}: give <publisher.name>@<version>`);
  const id = spec.slice(0, at).toLowerCase();
  const version = spec.slice(at + 1);
  const list = readList();
  const extension = list.extensions.find((e) => e.id.toLowerCase() === id);
  if (!extension) throw new Error(`${spec.slice(0, at)} is not in the corpus (test/corpus/extensions.json)`);
  const data = await fetchFile(openVsxUrl(extension.id, version, 'vsix'));
  const published = (await fetchFile(openVsxUrl(extension.id, version, 'sha256'))).toString('utf8').trim().split(' ')[0];
  const actual = sha256(data);
  if (published?.toLowerCase() !== actual) {
    throw new Error(`${extension.id} ${version}: the SHA-256 of the download is ${actual}, Open VSX publishes ${String(published)}`);
  }
  rmSync(vsixPath(extension), { force: true });
  saveVsix({ id: extension.id, version }, data);
  console.log(`${extension.id}: ${extension.version} -> ${version}, SHA-256 ${actual}`);
  extension.version = version;
  extension.sha256 = actual;
  writeList(list);
}

/** The themes and warnings that the package gives for each extension. */
async function results(extensions: readonly CorpusExtension[]): Promise<ExtensionResult[]> {
  const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-corpus-'));
  try {
    const all: ExtensionResult[] = [];
    for (const extension of extensions) {
      const folder = join(temp, extension.id);
      await extractVsix(vsixPath(extension), folder);
      all.push(extensionResult(extension, auditPaths(['.'], { version: '0.0.0', cwd: folder })));
    }
    return all;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (options.update !== undefined) await update(options.update);
  const { extensions } = readList();
  await downloadAll(extensions);
  if (options.update !== undefined || options.expected === true) {
    const all = await results(extensions);
    writeExpected(all);
    const themes = all.reduce((sum, e) => sum + e.themes.length, 0);
    const warnings = all.reduce((sum, e) => sum + e.warnings.length + e.themes.reduce((n, t) => n + t.warnings.length, 0), 0);
    console.log(`wrote ${display(EXPECTED)}: ${String(themes)} themes, ${String(warnings)} warnings`);
  }
}

main().catch((error: unknown) => {
  console.error(`corpus: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
