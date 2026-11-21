// The corpus: theme extensions of Open VSX at fixed versions (extensions.json), and what the package gives for
// them (expected.json). Their .vsix files are downloaded into a cache that is not committed, .cache/corpus/: not
// every license of these extensions allows it. Used by scripts/corpus.ts and by corpus.test.ts.

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { open } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

import type { Report } from '../../src/report.ts';

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

const ATTEMPTS = 4;

/** Downloads a file, trying again when the network or the server fails, but not when the file is missing. */
export async function fetchFile(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    let failure: unknown;
    let retry: boolean;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      failure = new Error(`${url}: HTTP ${String(response.status)}`);
      retry = response.status >= 500 || response.status === 429;
    } catch (error) {
      // The network fails, or the server takes more than a minute
      failure = error;
      retry = true;
    }
    if (!retry || attempt === ATTEMPTS) throw failure;
    await sleep(2000 * attempt);
  }
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

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    open(file, { lazyEntries: true }, (error, zip) => {
      if (error) reject(error);
      else resolve(zip);
    });
  });
}

function openEntry(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

/**
 * Extracts a .vsix into a folder as VS Code installs it (extract() of src/vs/base/node/zip.ts, with the source
 * path 'extension'): with yauzl, the entries whose name starts with "extension", without this prefix. So
 * extension/package.json gives package.json, and extension.vsixmanifest gives .vsixmanifest, as in VS Code.
 */
export async function extractVsix(file: string, target: string): Promise<void> {
  const zip = await openZip(file);
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        extractEntry(zip, entry, target).then(() => { zip.readEntry(); }, reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

async function extractEntry(zip: ZipFile, entry: Entry, target: string): Promise<void> {
  if (!entry.fileName.startsWith('extension')) return;
  const name = entry.fileName.slice('extension'.length);
  const path = join(target, name);
  const inside = relative(target, path);
  // yauzl already refuses absolute names and '..'; VS Code checks the folder too
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`${entry.fileName}: outside the extension folder`);
  // The name of a folder ends with '/'
  if (name.endsWith('/')) {
    mkdirSync(path, { recursive: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  await pipeline(await openEntry(zip, entry), createWriteStream(path));
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
