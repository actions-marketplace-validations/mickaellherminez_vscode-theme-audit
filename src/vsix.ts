// Reads a packaged extension (.vsix): a zip file whose folder `extension/` is what VS Code installs. It is extracted
// as VS Code extracts it (extract() of src/vs/base/node/zip.ts in VS Code 1.147.0, with the source path
// 'extension'), with yauzl, the zip library of VS Code, into a folder that the audit then reads.

import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { open } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

import { ThemeError } from './theme.ts';

/**
 * Limits for a .vsix, which may come from anywhere: the number of entries, and the size of the extracted files, as
 * the zip declares them and as they are read. A theme extension takes a few megabytes at most: the largest of the
 * corpus, Bearded Theme with its 64 themes, takes less than 10 MB.
 */
export const VSIX_LIMITS = { entries: 10_000, bytes: 200 * 1024 * 1024 };

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // yauzl refuses absolute names, '..' and entries whose size differs from what the zip declares
    open(file, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
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
 * Extracts a .vsix into a folder as VS Code installs it: the entries whose name starts with "extension", without
 * this prefix. So extension/package.json gives package.json, and extension.vsixmanifest gives .vsixmanifest, as in
 * VS Code. A file that is not a zip, an entry outside the folder, or a limit passed is a ThemeError.
 */
export async function extractVsix(file: string, target: string, limits = VSIX_LIMITS): Promise<void> {
  let zip: ZipFile;
  try {
    zip = await openZip(file);
  } catch (error) {
    throw new ThemeError(file, `not a .vsix file (${error instanceof Error ? error.message : String(error)})`);
  }
  let entries = 0;
  let bytes = 0;
  const count = (size: number) => {
    bytes += size;
    if (bytes > limits.bytes) throw new ThemeError(file, `its files take more than ${String(limits.bytes / 1024 / 1024)} MB`);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        const extract = async () => {
          if (++entries > limits.entries) throw new ThemeError(file, `it has more than ${String(limits.entries)} entries`);
          await extractEntry(zip, entry, target, file, count);
        };
        extract().then(() => { zip.readEntry(); }, reject);
      });
      zip.readEntry();
    });
  } catch (error) {
    if (error instanceof ThemeError) throw error;
    throw new ThemeError(file, `cannot be extracted (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    zip.close();
  }
}

async function extractEntry(zip: ZipFile, entry: Entry, target: string, file: string, count: (size: number) => void): Promise<void> {
  if (!entry.fileName.startsWith('extension')) return;
  const name = entry.fileName.slice('extension'.length);
  const path = join(target, name);
  const inside = relative(target, path);
  // yauzl already refuses absolute names and '..'; VS Code checks the folder too
  if (inside.startsWith('..') || isAbsolute(inside)) throw new ThemeError(file, `${entry.fileName}: outside the extension folder`);
  // The name of a folder ends with '/'
  if (name.endsWith('/')) {
    mkdirSync(path, { recursive: true });
    return;
  }
  count(entry.uncompressedSize);
  mkdirSync(dirname(path), { recursive: true });
  // The size declared is checked by yauzl; the bytes read are counted too, in case a zip declares less
  let read = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      read += chunk.length;
      if (read > entry.uncompressedSize) done(new ThemeError(file, `${entry.fileName}: larger than its declared size`));
      else done(null, chunk);
    },
  });
  await pipeline(await openEntry(zip, entry), counter, createWriteStream(path));
}
