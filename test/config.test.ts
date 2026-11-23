import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { Ajv2020 } from 'ajv/dist/2020.js';

import { isFailure } from '../src/audit.ts';
import { CONFIG_FILE, DEFAULT_THRESHOLDS, loadConfig } from '../src/config.ts';
import { main } from '../src/main.ts';
import { auditInputs, auditPaths, textReport } from '../src/report.ts';
import type { Report, ThemeReport } from '../src/report.ts';
import { ThemeError } from '../src/theme.ts';
import { schemaErrors, validateReport } from './report-schema.ts';
import { zip } from './zip.ts';

const ROOT = new URL('..', import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-config-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });

const configSchema = JSON.parse(readFileSync(new URL('schema/config-v1.schema.json', ROOT), 'utf8')) as object;
const validateConfig = new Ajv2020({ allErrors: true, strict: true }).compile(configSchema);

let count = 0;
/** A copy of the test extension of four themes, with this configuration in its folder (none when undefined). */
function extension(config?: unknown): string {
  const folder = join(temp, `extension-${String(++count)}`);
  cpSync(new URL('test/data/oracle-extension', ROOT), folder, { recursive: true });
  if (config !== undefined) writeFileSync(join(folder, CONFIG_FILE), typeof config === 'string' ? config : JSON.stringify(config));
  return folder;
}

function configFile(content: unknown): string {
  const file = join(temp, `config-${String(++count)}.json`);
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

function audit(folder: string, options: { strict?: boolean; config?: string } = {}): Report {
  const report = auditPaths([folder], { version: 'test', cwd: temp, ...options });
  assert.ok(validateReport(report), schemaErrors());
  return report;
}

const dark = (report: Report): ThemeReport => {
  const theme = report.themes.find((t) => t.label === 'Oracle Dark');
  assert.ok(theme);
  return theme;
};

describe('reading a configuration', () => {
  test('thresholds and exceptions, with the defaults for what is not given', () => {
    const file = configFile(`{
      // Comments and trailing commas, as in the settings of VS Code
      "$schema": "../schema/config-v1.schema.json",
      "thresholds": { "deltaE2000": 10, },
      "ignore": [
        { "check": "Line numbers", "reason": "Dimmed on purpose" },
        { "pair": ["keyword", "function"], "view": "tritan", "theme": "Oracle Dark", "reason": "Different styles" },
      ],
    }`);
    const config = loadConfig(file);
    assert.deepEqual(config.thresholds, { ...DEFAULT_THRESHOLDS, deltaE2000: 10 });
    assert.deepEqual(config.ignore, [
      { check: 'Line numbers', reason: 'Dimmed on purpose' },
      { pair: ['keyword', 'function'], view: 'tritan', theme: 'Oracle Dark', reason: 'Different styles' },
    ]);
  });

  // Each invalid configuration is refused by the package and by the schema alike
  const invalid: [string, unknown, RegExp][] = [
    ['not an object', [], /must be an object/],
    ['an unknown key', { rules: {} }, /unknown key "rules"/],
    ['an unknown threshold', { thresholds: { selection: 2 } }, /unknown threshold "selection"/],
    ['a contrast out of range', { thresholds: { text: 30 } }, /thresholds\.text must be a number from 1 to 21/],
    ['a threshold that is not a number', { thresholds: { deltaE2000: '7' } }, /thresholds\.deltaE2000 must be a number/],
    ['an exception without a reason', { ignore: [{ check: 'Line numbers' }] }, /ignore\[0\] needs a reason/],
    ['an empty reason', { ignore: [{ check: 'Line numbers', reason: ' ' }] }, /needs a reason/],
    ['a check and a pair', { ignore: [{ check: 'Line numbers', pair: ['a', 'b'], reason: 'x' }] }, /names a check or a pair, not both/],
    ['a pair of three', { ignore: [{ pair: ['a', 'b', 'c'], reason: 'x' }] }, /pair must be two names/],
    ['an unknown vision', { ignore: [{ pair: ['a', 'b'], view: 'gray', reason: 'x' }] }, /view must be normal, protan, deutan, tritan/],
    ['an exception that names nothing', { ignore: [{ reason: 'x' }] }, /needs a check or a pair/],
    ['an unknown key in an exception', { ignore: [{ check: 'x', reason: 'x', because: 'y' }] }, /unknown key "because"/],
  ];
  for (const [what, content, message] of invalid) {
    test(`refuses ${what}`, () => {
      const file = configFile(content);
      assert.throws(() => loadConfig(file), (error: unknown) => error instanceof ThemeError && message.test(error.message));
      assert.equal(validateConfig(content), false, 'the schema accepts it');
    });
  }

  test('the schema accepts what the package accepts', () => {
    const valid = { $schema: 'x', thresholds: { text: 5, enhancedText: 7.5, nonText: 3, deltaE2000: 8 }, ignore: [{ check: 'Cursor', theme: 'Night', reason: 'x' }, { pair: ['error', 'warning'], view: 'deutan', reason: 'x' }] };
    assert.ok(validateConfig(valid), JSON.stringify(validateConfig.errors));
    loadConfig(configFile(valid));
  });

  test('a syntax error gives its line, and stops the audit with an error', () => {
    const folder = extension('{ "thresholds": ');
    assert.throws(() => audit(folder), /invalid configuration/);
  });
});

describe('exceptions', () => {
  test('an ignored check stays in the report with its reason, and no longer counts as a failure', () => {
    const without = dark(audit(extension()));
    const folder = extension({ ignore: [{ check: 'Line numbers', reason: 'Dimmed on purpose' }] });
    const report = audit(folder);
    const theme = dark(report);
    const check = theme.checks?.find((c) => c.label === 'Line numbers');
    assert.ok(check);
    assert.equal(check.status, 'fail');
    assert.equal(check.ignored, 'Dimmed on purpose');
    assert.equal(isFailure(check), false);
    assert.ok(theme.summary && without.summary);
    assert.equal(theme.summary.failed, without.summary.failed - 1);
    assert.equal(theme.summary.ignored, 1);
    assert.equal(theme.config, `${folder.slice(temp.length + 1)}/${CONFIG_FILE}`);
    const text = textReport(report);
    assert.match(text, /\n {2}IGNORED {2}Line numbers: #858585 on #1B2230 {2}4\.32 < 4\.5 {2}\(ignored: Dimmed on purpose\)\n/);
    assert.match(text, /ignored by the configuration/);
  });

  test('a pair is ignored in every vision, or in one, in either order', () => {
    const all = dark(audit(extension({ ignore: [{ pair: ['function', 'keyword'], reason: 'Bold keywords' }] })));
    const pairs = all.distinctions?.filter((d) => d.pair.join() === 'keyword,function') ?? [];
    assert.equal(pairs.length, 4);
    assert.ok(pairs.every((d) => d.ignored === 'Bold keywords' && !isFailure(d)));
    const one = dark(audit(extension({ ignore: [{ pair: ['keyword', 'function'], view: 'tritan', reason: 'Tritan only' }] })));
    assert.deepEqual(one.distinctions?.filter((d) => d.ignored !== undefined).map((d) => d.view), ['tritan']);
    assert.equal(one.summary?.ignored, 1);
  });

  test('an exception for one theme leaves the others alone', () => {
    const report = audit(extension({ ignore: [{ check: 'Line numbers', theme: 'Oracle Dark', reason: 'Dark only' }] }));
    for (const theme of report.themes) {
      const ignored = theme.checks?.some((c) => c.ignored !== undefined) ?? false;
      assert.equal(ignored, theme.label === 'Oracle Dark', theme.label);
    }
  });

  test('an exception that names nothing, or only checks that pass, gives a warning', () => {
    const report = audit(extension({ ignore: [
      { check: 'Line number', reason: 'A typo' },
      { check: 'Editor: text / background', theme: 'Oracle Dark', reason: 'It passes' },
    ] }));
    assert.deepEqual(report.warnings.map((w) => w.replace(/^.*?: /, '')), [
      'the check "Line number" matches nothing: fix its name or remove it',
      'the check "Editor: text / background" of the theme "Oracle Dark" passes: the exception can be removed',
    ]);
  });

  test('a missing color is ignored in strict mode too', () => {
    const report = audit(extension({ ignore: [{ check: 'Required key: chat.slashCommandBackground', reason: 'No chat in this theme' }] }), { strict: true });
    const theme = dark(report);
    const check = theme.checks?.find((c) => c.label === 'Required key: chat.slashCommandBackground');
    assert.ok(check);
    assert.equal(check.status, 'missing');
    assert.equal(isFailure(check, true), false);
    assert.ok(!report.warnings.some((w) => w.includes('passes')));
  });
});

describe('thresholds', () => {
  test('a raised threshold applies to every check that uses it, and the report shows it', () => {
    const theme = dark(audit(extension({ thresholds: { text: 5 } })));
    assert.ok(theme.checks);
    assert.equal(theme.checks.some((c) => c.minimum === 4.5), false);
    const check = theme.checks.find((c) => c.label === 'Editor: text / background');
    assert.equal(check?.minimum, 5);
    assert.deepEqual(theme.thresholds, { ...DEFAULT_THRESHOLDS, text: 5 });
  });

  test('a lowered threshold gives a warning, and the pairs follow the CIEDE2000 one', () => {
    const report = audit(extension({ thresholds: { nonText: 2, deltaE2000: 0 } }));
    assert.deepEqual(report.warnings.map((w) => w.replace(/^.*?: /, '')), [
      'the configuration lowers the minimum for non-text elements (WCAG 2.2) from 3 to 2',
      'the configuration lowers the minimum for colors that must stay distinct (CIEDE2000) from 7 to 0',
    ]);
    const theme = dark(report);
    assert.equal(theme.summary?.confused, 0);
    assert.match(textReport(report), /achromatopsia: 0 of 21 pairs under 0 \(information\)/);
  });
});

describe('where the configuration comes from', () => {
  test('--config applies to every input, instead of the file of the folder', () => {
    const folder = extension({ ignore: [{ check: 'Line numbers', reason: 'From the folder' }] });
    const given = configFile({ ignore: [{ check: 'Cursor', reason: 'Given' }] });
    const theme = dark(audit(folder, { config: given }));
    assert.equal(theme.checks?.find((c) => c.label === 'Line numbers')?.ignored, undefined);
    assert.equal(theme.config, given.slice(temp.length + 1));
  });

  test('a theme file uses the configuration of its extension folder', () => {
    const folder = extension({ ignore: [{ check: 'Line numbers', reason: 'From the folder' }] });
    const [theme] = auditPaths([join(folder, 'themes', 'dark.json')], { version: 'test', cwd: temp }).themes;
    assert.ok(theme);
    assert.equal(theme.checks?.find((c) => c.label === 'Line numbers')?.ignored, 'From the folder');
  });

  test('a .vsix uses the configuration that it contains', async () => {
    const folder = extension();
    const entries: Record<string, string> = { [`extension/${CONFIG_FILE}`]: JSON.stringify({ ignore: [{ check: 'Line numbers', reason: 'Packaged' }] }) };
    for (const name of ['package.json', 'themes/dark.json', 'themes/dark-base.json', 'themes/light.json', 'themes/hc-dark.json', 'themes/hc-light.json']) {
      entries[`extension/${name}`] = readFileSync(join(folder, name), 'utf8');
    }
    writeFileSync(join(temp, 'packaged.vsix'), zip(entries));
    const report = await auditInputs(['packaged.vsix'], { version: 'test', cwd: temp });
    const theme = dark(report);
    assert.equal(theme.checks?.find((c) => c.label === 'Line numbers')?.ignored, 'Packaged');
    assert.equal(theme.config, `packaged.vsix/extension/${CONFIG_FILE}`);
  });

  test('the command takes --config <file> and --config=<file>, and refuses it without a file', async () => {
    const given = configFile({ ignore: [{ check: 'Line numbers', reason: 'Given' }] });
    const run = async (args: string[]) => {
      let out = '';
      let err = '';
      const code = await main(args, { out: (text) => { out += text; }, err: (text) => { err += text; } }, temp);
      return { code, out, err };
    };
    const folder = extension();
    for (const args of [['--config', given, folder], [`--config=${given}`, folder]]) {
      const { out } = await run([...args, '--json']);
      assert.equal(dark(JSON.parse(out) as Report).checks?.find((c) => c.label === 'Line numbers')?.ignored, 'Given');
    }
    for (const args of [[folder, '--config'], ['--config', '--json', folder], ['--config=', folder], ['--config', given, '--config', given, folder]]) {
      const { code, err } = await run(args);
      assert.equal(code, 2, args.join(' '));
      assert.match(err, /--config/);
    }
    const missing = await run(['--config', join(temp, 'none.json'), folder]);
    assert.equal(missing.code, 2);
    assert.match(missing.err, /no such configuration file/);
  });
});
