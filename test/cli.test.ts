// The command: its options, its text and JSON reports, and its exit codes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';

import { HELP, main, packageVersion } from '../src/main.ts';
import type { Report } from '../src/report.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'test', 'data');

function run(args: string[], cwd = ROOT) {
  let out = '';
  let err = '';
  const code = main(args, { out: (text) => { out += text; }, err: (text) => { err += text; } }, cwd);
  return { code, out, err };
}

const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'report-v1.schema.json'), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);

/** The JSON report, checked against its schema. */
function json(args: string[], cwd = ROOT): { code: number; report: Report } {
  const { code, out, err } = run([...args, '--json'], cwd);
  assert.equal(err, '');
  const report = JSON.parse(out) as Report;
  assert.ok(validate(report), JSON.stringify(validate.errors?.slice(0, 3)));
  return { code, report };
}

const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });

function write(path: string, content: unknown): string {
  const file = join(temp, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

describe('options', () => {
  test('the version is the one of package.json', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    assert.equal(packageVersion(), manifest.version);
    for (const flag of ['-v', '--version']) {
      assert.deepEqual(run([flag]), { code: 0, out: `${manifest.version}\n`, err: '' });
    }
  });

  test('the help is printed on demand, and on a usage error', () => {
    assert.deepEqual(run(['--help']), { code: 0, out: HELP, err: '' });
    assert.deepEqual(run(['-h', 'theme.json']), { code: 0, out: HELP, err: '' });
    assert.deepEqual(run([]), { code: 2, out: '', err: HELP });
    assert.deepEqual(run(['--json']), { code: 2, out: '', err: HELP });
    const unknown = run(['--colors', 'test/data/365']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.err, /^Unknown option: --colors\n/);
  });

  test('the help gives the exit codes and the version of VS Code', () => {
    assert.match(HELP, /0 {2}every check passes\n {2}1 {2}a check fails\n {2}2 {2}a theme cannot be read, or the command is misused/);
    assert.match(HELP, /VS Code 1\.147\.0/);
  });
});

describe('exit code 0: every check passes', () => {
  test('the 48 themes of 365 Day & Night, in strict mode, with the variety between them', () => {
    const { code, out, err } = run(['test/data/365', '--strict']);
    assert.equal(err, '');
    assert.equal(code, 0);
    assert.match(out, /^vscode-theme-audit .+, colors of VS Code 1\.147\.0, strict mode \(rules of 365 Day & Night\)\n/);
    assert.match(out, /\n365 01-January Light \(vs\): test\/data\/365\/themes\/365-01-light-theme\.json\n {2}273 of 273 checks pass; 148 of 148 pairs stay distinct; /);
    assert.match(out, /\nVariety of test\/data\/365, hc-light \(12 themes\)\n {2}every pair of themes stays distinct\n/);
    assert.ok(out.endsWith('\n48 themes: 0 with failures, 0 failures\n'));
  });

  test('the JSON report of the same audit', () => {
    const { code, report } = json(['test/data/365', '--strict']);
    assert.equal(code, 0);
    assert.equal(report.format, 1);
    assert.deepEqual(report.vscode.version, '1.147.0');
    assert.equal(report.strict, true);
    assert.equal(report.themes.length, 48);
    assert.deepEqual(report.variety.map((v) => [v.uiTheme, v.themes.length, v.failures.length]), [['vs', 12, 0], ['vs-dark', 12, 0], ['hc-black', 12, 0], ['hc-light', 12, 0]]);
    assert.deepEqual(report.summary, { themes: 48, themesWithFailures: 0, failures: 0, unreadable: 0 });
  });

  test('a theme file takes its type and label from the extension that declares it', () => {
    const { report } = json(['test/data/365/themes/365-07-hc-light-theme.json', '--strict']);
    assert.deepEqual(report.themes.map((t) => [t.label, t.uiTheme, t.file]), [['365 07-July High Contrast Light', 'hc-light', 'test/data/365/themes/365-07-hc-light-theme.json']]);
    // The color of the extension is known: the status bar button is checked
    assert.ok(report.themes[0]?.checks?.some((c) => c.label === 'Status bar button / status bar' && c.status === 'pass'));
    assert.deepEqual(report.variety, []);
  });
});

describe('exit code 1: a check fails', () => {
  test('the text report gives each failure with its colors, the value and the minimum, then a summary', () => {
    const { code, out } = run(['test/data/oracle-extension']);
    assert.equal(code, 1);
    assert.match(out, /\nOracle Light \(vs\): test\/data\/oracle-extension\/themes\/light\.json\n {2}warning: test\/data\/oracle-extension\/themes\/light\.json: "button\.background" is not a hexadecimal color \("blue"\): VS Code shows #FF0000\n/);
    assert.match(out, /\n {2}FAIL {5}Editor: text \/ background: #79898B on #FDF6E3 {2}3\.38 < 4\.5\n/);
    assert.match(out, /\n {2}FAIL {5}button\.foreground \/ button\.background: #FFFFFF on #FF0000 {2}4\.00 < 4\.5\n/);
    assert.match(out, /\n {2}\d+ of \d+ checks pass; \d+ of \d+ pairs stay distinct; \d+ colors that VS Code does not show \(information\); /);
    assert.match(out, /\n4 themes: 4 with failures, \d+ failures\n$/);
  });

  test('confused colors, with their vision, colors, difference and model', () => {
    const theme = write('confused/theme.json', {
      type: 'dark',
      colors: { 'editor.background': '#1E1E2E', 'editor.foreground': '#CDD6F4' },
      tokenColors: [{ scope: 'keyword', settings: { foreground: '#CBA6F7' } }, { scope: 'entity.name.function', settings: { foreground: '#CBA6F7' } }],
    });
    const { code, out } = run([theme], temp);
    assert.equal(code, 1);
    assert.match(out, /\n {2}CONFUSED keyword \/ function \(#CBA6F7 \/ #CBA6F7\): ΔE2000 under 7: normal 0\.0, protan 0\.0 \(Machado 2009\), deutan 0\.0 \(Machado 2009\), tritan 0\.0 \(Brettel 1997\)\n/);
  });

  test('the JSON report gives every check, and the failures in its summary', () => {
    const { code, report } = json(['test/data/oracle-extension']);
    assert.equal(code, 1);
    assert.equal(report.strict, false);
    const light = report.themes[0];
    assert.equal(light?.uiTheme, 'vs');
    assert.ok(light.summary && light.checks && light.summary.checks === light.checks.length);
    assert.ok(light.checks.some((c) => c.status === 'pass'));
    assert.ok(report.summary.failures > 0);
    assert.equal(report.summary.unreadable, 0);
  });

  test('--strict applies the rules of 365 Day & Night', () => {
    const general = json(['test/data/oracle-extension']).report;
    const strict = json(['test/data/oracle-extension', '--strict']).report;
    assert.ok(strict.summary.failures > general.summary.failures);
    assert.ok(strict.themes[0]?.checks?.some((c) => c.label.startsWith('Required key: ') && c.status === 'missing'));
    assert.equal(general.themes[0]?.checks?.some((c) => c.label.startsWith('Required key: ')), false);
    assert.deepEqual(strict.variety.map((v) => v.uiTheme), []);
  });
});

describe('exit code 2: a theme cannot be read, or the command is misused', () => {
  test('a theme that VS Code would refuse is reported, and the others are still audited', () => {
    write('broken/package.json', { contributes: { themes: [
      { label: 'Good', uiTheme: 'vs-dark', path: './good.json' },
      { label: 'Broken', uiTheme: 'vs', path: './broken.json' },
    ] } });
    write('broken/good.json', { colors: { 'editor.background': '#1E1E2E' } });
    write('broken/broken.json', '{ "colors": { "editor.background": "#FFFFFF" ');
    const { code, out } = run(['broken'], temp);
    assert.equal(code, 2);
    assert.match(out, /\nBroken \(vs\): broken\/broken\.json\n {2}ERROR {4}VS Code cannot parse this JSON: /);
    assert.match(out, /\nGood \(vs-dark\): broken\/good\.json\n(?: {2}.*\n)*? {2}\d+ of \d+ checks pass/);
    assert.match(out, /, 1 unreadable\n$/);
    const { report } = json(['broken'], temp);
    assert.equal(report.summary.unreadable, 1);
    assert.deepEqual(Object.keys(report.themes[1] ?? {}).sort(), ['error', 'file', 'label', 'uiTheme', 'warnings']);
  });

  test('a path that does not exist, or a folder without themes', () => {
    const missing = run(['nothing-here.json'], temp);
    assert.equal(missing.code, 2);
    assert.equal(missing.out, '');
    assert.match(missing.err, /^vscode-theme-audit: .*nothing-here\.json: no such file or folder\n$/);
    write('empty/package.json', { name: 'not-a-theme' });
    const empty = run(['empty', '--json'], temp);
    assert.equal(empty.code, 2);
    assert.equal(empty.out, '');
    assert.match(empty.err, /this extension contributes no color theme/);
  });
});

describe('a theme file outside an extension', () => {
  test('its type comes from the file, otherwise it is audited as dark with a warning', () => {
    write('alone/light.json', { name: 'Alone Light', type: 'light', colors: { 'editor.background': '#FFFFFF' } });
    write('alone/untyped.json', { colors: { 'editor.background': '#1E1E1E' } });
    const { report } = json(['alone/light.json', 'alone/untyped.json'], temp);
    assert.deepEqual(report.themes.map((t) => [t.label, t.uiTheme]), [['Alone Light', 'vs'], ['untyped.json', 'vs-dark']]);
    assert.deepEqual(report.themes[1]?.warnings, ["alone/untyped.json: no extension declares this theme and its 'type' is missing or unknown: audited as dark (vs-dark), as VS Code shows it"]);
  });
});

test('a reader that stops early, such as head, does not make the command fail', { skip: process.platform === 'win32' }, () => {
  const cli = join(ROOT, 'src', 'cli.ts');
  const result = spawnSync('sh', ['-c', `"${process.execPath}" "${cli}" test/data/365 --json | head -c 20`], { encoding: 'utf8', cwd: ROOT });
  assert.equal(result.stdout, '{\n  "format": 1,\n  "');
  assert.equal(result.stderr, '');
});

test('the command runs from its source file, and gives its exit code', () => {
  const cli = join(ROOT, 'src', 'cli.ts');
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, `${packageVersion()}\n`);
  const failing = spawnSync(process.execPath, [cli, join(DATA, 'oracle-extension', 'themes', 'dark.json')], { encoding: 'utf8', cwd: ROOT });
  assert.equal(failing.status, 1, failing.stderr);
  assert.match(failing.stdout, /^vscode-theme-audit /);
});
