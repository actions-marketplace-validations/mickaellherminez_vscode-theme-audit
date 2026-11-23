import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { main } from '../src/main.ts';
import { OPEN_VSX_API, downloadOpenVsx, isOpenVsxInput, parseOpenVsxInput } from '../src/open-vsx.ts';
import type { Fetcher } from '../src/open-vsx.ts';
import type { Report } from '../src/report.ts';
import { ThemeError } from '../src/theme.ts';
import { EXTENSION, zip } from './zip.ts';

const VSIX = zip(EXTENSION);
const SHA256 = createHash('sha256').update(VSIX).digest('hex');
const FILES = `${OPEN_VSX_API}/someone/night/1.0.0/file`;

/** A stand-in for Open VSX, with one extension, someone.night, at version 1.0.0; it records the addresses asked. */
function registry(options: { sha256?: string; downloadable?: boolean } = {}): { fetcher: Fetcher; asked: string[] } {
  const asked: string[] = [];
  const metadata = {
    namespace: 'someone', name: 'night', version: '1.0.0', downloadable: options.downloadable ?? true,
    files: { download: `${FILES}/someone.night-1.0.0.vsix`, sha256: `${FILES}/someone.night-1.0.0.sha256` },
  };
  const fetcher: Fetcher = (url) => {
    asked.push(url);
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    if (url === `${OPEN_VSX_API}/someone/night` || url === `${OPEN_VSX_API}/someone/night/1.0.0`) return json(metadata);
    if (url === metadata.files.download) return Promise.resolve(new Response(VSIX));
    if (url === metadata.files.sha256) return Promise.resolve(new Response(`${options.sha256 ?? SHA256}  someone.night-1.0.0.vsix\n`));
    return json({ error: `Extension not found: ${url}` }, 404);
  };
  return { fetcher, asked };
}

describe('an Open VSX id', () => {
  test('is open-vsx:publisher.name, with or without a version', () => {
    assert.equal(isOpenVsxInput('open-vsx:someone.night'), true);
    assert.equal(isOpenVsxInput('someone.night'), false);
    assert.deepEqual(parseOpenVsxInput('open-vsx:someone.night'), { namespace: 'someone', name: 'night' });
    assert.deepEqual(parseOpenVsxInput('open-vsx:someone.night@1.0.0'), { namespace: 'someone', name: 'night', version: '1.0.0' });
    assert.deepEqual(parseOpenVsxInput('open-vsx:Some_One.night.theme@2.0.0-beta.1'), { namespace: 'Some_One', name: 'night.theme', version: '2.0.0-beta.1' });
  });

  test('anything else is refused, before any download', () => {
    for (const input of ['open-vsx:', 'open-vsx:night', 'open-vsx:.night', 'open-vsx:someone.', 'open-vsx:some/one.night', 'open-vsx:someone.night@', 'open-vsx:someone.night@1/0', 'open-vsx:../x.y']) {
      assert.throws(() => parseOpenVsxInput(input), ThemeError, input);
    }
  });
});

describe('downloading from Open VSX', () => {
  test('the latest version, or the one asked, checked against its SHA-256', async () => {
    const { fetcher, asked } = registry();
    const latest = await downloadOpenVsx({ namespace: 'someone', name: 'night' }, fetcher);
    assert.equal(latest.version, '1.0.0');
    assert.deepEqual(latest.data, VSIX);
    assert.equal(asked[0], `${OPEN_VSX_API}/someone/night`);
    const pinned = await downloadOpenVsx({ namespace: 'someone', name: 'night', version: '1.0.0' }, fetcher);
    assert.equal(pinned.version, '1.0.0');
  });

  test('a missing extension or version, a SHA-256 that differs, or a version that cannot be downloaded is a ThemeError', async () => {
    await assert.rejects(downloadOpenVsx({ namespace: 'someone', name: 'day' }, registry().fetcher), /open-vsx:someone\.day: not found on Open VSX \(Extension not found/);
    await assert.rejects(downloadOpenVsx({ namespace: 'someone', name: 'night', version: '9.9.9' }, registry().fetcher), /not found on Open VSX/);
    await assert.rejects(downloadOpenVsx({ namespace: 'someone', name: 'night' }, registry({ sha256: '0'.repeat(64) }).fetcher), /is not the one Open VSX publishes/);
    await assert.rejects(downloadOpenVsx({ namespace: 'someone', name: 'night' }, registry({ downloadable: false }).fetcher), /does not allow downloading it/);
  });
});

describe('the command with an Open VSX id', () => {
  async function run(args: string[], fetcher: Fetcher) {
    let out = '';
    let err = '';
    const code = await main(args, { out: (text) => { out += text; }, err: (text) => { err += text; } }, process.cwd(), fetcher);
    return { code, out, err };
  }

  test('audits the extension, named by its id and the version found', async () => {
    const { code, out, err } = await run(['open-vsx:someone.night', '--json'], registry().fetcher);
    assert.equal(err, '');
    const report = JSON.parse(out) as Report;
    assert.equal(code, report.summary.failures > 0 ? 1 : 0);
    const [theme] = report.themes;
    assert.ok(theme);
    assert.equal(theme.label, 'Night');
    assert.equal(theme.file, 'open-vsx:someone.night@1.0.0/extension/themes/night.json');
  });

  test('an extension that cannot be found exits with code 2 and says why', async () => {
    const { code, out, err } = await run(['open-vsx:someone.day'], registry().fetcher);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /^vscode-theme-audit: open-vsx:someone\.day: not found on Open VSX/);
  });
});
