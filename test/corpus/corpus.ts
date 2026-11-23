// The corpus: theme extensions of Open VSX at fixed versions (extensions.json), and what the package gives for
// them (expected.json). Their .vsix files are downloaded into a cache that is not committed, .cache/corpus/: not
// every license of these extensions allows it. Used by scripts/corpus.ts and by corpus.test.ts.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchFile } from '../../src/open-vsx.ts';
import type { Report } from '../../src/report.ts';

// The download and the extraction are those of the package (src/open-vsx.ts and src/vsix.ts)
export { fetchFile } from '../../src/open-vsx.ts';
export { extractVsix } from '../../src/vsix.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const LIST = join(HERE, 'extensions.json');
export const EXPECTED = join(HERE, 'expected.json');
export const CACHE = join(HERE, '..', '..', '.cache', 'corpus');

export interface CorpusExtension {
  /** publisher.name, as Open VSX writes it. */
  id: string;
  version: string;
  /** SHA-256 of the .vsix file, in lowercase hexadecimal. */
  sha256: string;
}

/** What the package gives for an extension: its themes and the warnings, paths relative to the extension. */
export interface ExtensionResult {
  id: string;
  version: string;
  warnings: string[];
  themes: { label: string; uiTheme: string; file: string; warnings: string[]; error?: string }[];
}

export function readList(): { description: string; extensions: CorpusExtension[] } {
  return JSON.parse(readFileSync(LIST, 'utf8')) as { description: string; extensions: CorpusExtension[] };
}

export function writeList(list: { description: string; extensions: CorpusExtension[] }): void {
  writeFileSync(LIST, JSON.stringify(list, null, 2) + '\n');
}

export function readExpected(): ExtensionResult[] {
  return JSON.parse(readFileSync(EXPECTED, 'utf8')) as ExtensionResult[];
}

export function writeExpected(results: ExtensionResult[]): void {
  writeFileSync(EXPECTED, JSON.stringify(results, null, 2) + '\n');
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The .vsix file of an extension in the cache. */
export function vsixPath(extension: { id: string; version: string }): string {
  return join(CACHE, `${extension.id}-${extension.version}.vsix`);
}

/** The address of a file of an extension version on Open VSX, such as its .vsix or its .sha256. */
export function openVsxUrl(id: string, version: string, extension: 'vsix' | 'sha256'): string {
  const dot = id.indexOf('.');
  if (dot <= 0) throw new Error(`${id}: an extension id is publisher.name`);
  const parts = [id.slice(0, dot), id.slice(dot + 1), version, 'file', `${id}-${version}.${extension}`];
  return `https://open-vsx.org/api/${parts.map(encodeURIComponent).join('/')}`;
}

/**
 * Puts the .vsix of an extension in the cache, unless it is there already, and checks its SHA-256. Returns
 * whether it was downloaded.
 */
export async function download(extension: CorpusExtension): Promise<boolean> {
  const file = vsixPath(extension);
  if (existsSync(file) && sha256(readFileSync(file)) === extension.sha256) return false;
  const data = await fetchFile(openVsxUrl(extension.id, extension.version, 'vsix'));
  const actual = sha256(data);
  if (actual !== extension.sha256) {
    throw new Error(`${extension.id} ${extension.version}: the SHA-256 of the download is ${actual}, not ${extension.sha256}`);
  }
  saveVsix(extension, data);
  return true;
}

export function saveVsix(extension: { id: string; version: string }, data: Buffer): void {
  const file = vsixPath(extension);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(`${file}.part`, data);
  renameSync(`${file}.part`, file);
}

/** What a report of the package gives for an extension, without the measures: themes and warnings. */
export function extensionResult(extension: CorpusExtension, report: Report): ExtensionResult {
  return {
    id: extension.id,
    version: extension.version,
    warnings: report.warnings,
    themes: report.themes.map((theme) => ({
      label: theme.label,
      uiTheme: theme.uiTheme,
      file: theme.file,
      warnings: theme.warnings,
      ...(theme.error === undefined ? {} : { error: theme.error }),
    })),
  };
}
