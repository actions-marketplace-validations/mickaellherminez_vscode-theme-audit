// Downloads an extension from Open VSX (open-vsx.org), the registry of VSCodium, Cursor, Gitpod and other editors,
// through its public REST API: the metadata of a version, its .vsix and the SHA-256 that Open VSX publishes.
// This is the only code of the package that uses the network, and only for an input `open-vsx:publisher.name`.

import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { ThemeError } from './theme.ts';

/** The public API of Open VSX. */
export const OPEN_VSX_API = 'https://open-vsx.org/api';

/** The prefix of an input that names an extension of Open VSX: `open-vsx:publisher.name[@version]`. */
export const OPEN_VSX_PREFIX = 'open-vsx:';

export interface OpenVsxRef {
  /** The namespace (publisher) and the name of the extension. */
  namespace: string;
  name: string;
  /** A version, or undefined for the latest one. */
  version?: string;
}

/** The function that downloads: fetch, or a stand-in in the tests. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

/** Whether an input names an extension of Open VSX rather than a file. */
export function isOpenVsxInput(input: string): boolean {
  return input.startsWith(OPEN_VSX_PREFIX);
}

/** Reads `open-vsx:publisher.name` or `open-vsx:publisher.name@version`; a ThemeError when it is not one. */
export function parseOpenVsxInput(input: string): OpenVsxRef {
  const id = input.slice(OPEN_VSX_PREFIX.length);
  const at = id.indexOf('@');
  const extension = at === -1 ? id : id.slice(0, at);
  const version = at === -1 ? undefined : id.slice(at + 1);
  const dot = extension.indexOf('.');
  const namespace = extension.slice(0, dot);
  const name = extension.slice(dot + 1);
  if (dot <= 0 || !NAMESPACE.test(namespace) || !NAME.test(name) || (version !== undefined && !VERSION.test(version))) {
    throw new ThemeError(input, 'an Open VSX extension is written open-vsx:publisher.name or open-vsx:publisher.name@version');
  }
  return version === undefined ? { namespace, name } : { namespace, name, version };
}

/** The input as the report names it, with the version found: `open-vsx:publisher.name@1.2.3`. */
export function openVsxLabel(ref: OpenVsxRef, version: string): string {
  return `${OPEN_VSX_PREFIX}${ref.namespace}.${ref.name}@${version}`;
}

const ATTEMPTS = 4;

/** Downloads a file, trying again when the network or the server fails, but not when the file is missing. */
export async function fetchFile(url: string, fetcher: Fetcher = fetch): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    let failure: unknown;
    let retry: boolean;
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
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

interface Metadata {
  version?: unknown;
  downloadable?: unknown;
  error?: unknown;
  files?: { download?: unknown; sha256?: unknown };
}

/**
 * Downloads the .vsix of an extension version from Open VSX, the latest one when the reference has no version,
 * and checks it against the SHA-256 that Open VSX publishes. A ThemeError when the extension or the version does
 * not exist, cannot be downloaded, or does not match.
 */
export async function downloadOpenVsx(ref: OpenVsxRef, fetcher: Fetcher = fetch): Promise<{ version: string; data: Buffer }> {
  const label = `${OPEN_VSX_PREFIX}${ref.namespace}.${ref.name}${ref.version === undefined ? '' : `@${ref.version}`}`;
  const path = [ref.namespace, ref.name, ...(ref.version === undefined ? [] : [ref.version])].map(encodeURIComponent).join('/');
  let metadata: Metadata;
  try {
    const response = await fetcher(`${OPEN_VSX_API}/${path}`, { signal: AbortSignal.timeout(60_000) });
    metadata = await response.json() as Metadata;
    if (!response.ok) throw new Error(typeof metadata.error === 'string' ? metadata.error : `HTTP ${String(response.status)}`);
  } catch (error) {
    throw new ThemeError(label, `not found on Open VSX (${error instanceof Error ? error.message : String(error)})`);
  }
  const { version, downloadable, files } = metadata;
  if (typeof version !== 'string' || typeof files?.download !== 'string' || typeof files.sha256 !== 'string') {
    throw new ThemeError(label, 'Open VSX gives no file to download for it');
  }
  if (downloadable === false) throw new ThemeError(label, 'Open VSX does not allow downloading it');
  let data: Buffer;
  let expected: string;
  try {
    data = await fetchFile(files.download, fetcher);
    expected = (await fetchFile(files.sha256, fetcher)).toString('utf8').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  } catch (error) {
    throw new ThemeError(label, `cannot be downloaded from Open VSX (${error instanceof Error ? error.message : String(error)})`);
  }
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== expected) throw new ThemeError(label, `the SHA-256 of the download (${actual}) is not the one Open VSX publishes (${expected})`);
  return { version, data };
}
