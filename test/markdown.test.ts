import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE } from '../src/config.ts';
import { markdownReport } from '../src/markdown.ts';
import { auditPaths, exitCode } from '../src/report.ts';
import type { Report } from '../src/report.ts';

const ROOT = new URL('..', import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-markdown-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });

function audit(paths: string[], strict = false): Report {
  return auditPaths(paths, { version: 'test', cwd: fileURLToPath(ROOT), strict });
}

test('Markdown reports real failed checks, grouped color pairs and information', () => {
  const report = audit(['test/data/oracle-extension/themes/dark.json']);
  const markdown = markdownReport(report);
  assert.ok(markdown.startsWith('# vscode-theme-audit\n\n**Result: FAIL.'));
  assert.ok(markdown.includes('1 theme: 1 with failures, 100 failures, 0 unreadable.'));
  assert.match(markdown, /Colors of VS Code 1&#46;147&#46;0/);
  assert.match(markdown, /\| FAIL \| Line numbers \| .* \| 4\.32 \| 4&#46;5 \| — \|/);
  assert.match(markdown, /keyword &#47; function/);
  const pairs = markdown.split('\n').filter((line) => line.startsWith('| CONFUSED | keyword &#47; function |'));
  assert.equal(pairs.length, 1, 'the same pair was repeated for each vision');
  for (const view of ['normal', 'protan', 'deutan', 'tritan']) assert.ok(pairs[0]?.includes(`${view}&#58;`));
  assert.match(markdown, /Information: 8 colors that VS Code does not show; 7 missing styles of WCAG 1\.4\.1/);
  assert.match(markdown, /achromatopsia 21 of 21 pairs under 7/);
  assert.doesNotMatch(markdown, /\| MISSING \|/);
  assert.doesNotMatch(markdown, /Details truncated/);
});

test('Markdown uses the configured thresholds and keeps ignored checks and visions with their reason', () => {
  const folder = join(temp, 'configured');
  cpSync(new URL('test/data/oracle-extension', ROOT), folder, { recursive: true });
  writeFileSync(join(folder, CONFIG_FILE), JSON.stringify({
    thresholds: { deltaE2000: 10 },
    ignore: [
      { check: 'Line numbers', reason: 'Dimmed on purpose' },
      { pair: ['keyword', 'function'], view: 'tritan', reason: 'Different styles' },
    ],
  }));
  const report = audit([join(folder, 'themes/dark.json')]);
  const before = JSON.stringify(report);
  const markdown = markdownReport(report);
  const summary = report.summary;
  assert.ok(markdown.includes(`${String(summary.failures)} failures, 0 unreadable.`));
  assert.match(markdown, /Configuration:/);
  assert.match(markdown, /Thresholds: text 4\.5, enhanced text 7, non-text 3, ΔE2000 10/);
  assert.match(markdown, /\| IGNORED \| Line numbers \| .* \| Dimmed on purpose \|/);
  assert.match(markdown, /\| IGNORED \| keyword &#47; function \| .* \| tritan&#58; .* \| Different styles \|/);
  assert.match(markdown, /\| CONFUSED \| keyword &#47; function \| .*normal&#58;.*protan&#58;.*deutan&#58;/);
  assert.match(markdown, /2 ignored by the configuration/);
  assert.match(markdown, /CIEDE2000 minimum: 10/);
  assert.equal(JSON.stringify(report), before, 'rendering changed the audit or its failure counts');
  assert.equal(exitCode(report), 1);
});

test('Markdown reports an unreadable theme and preserves the complete global totals', () => {
  const file = join(temp, 'broken.json');
  writeFileSync(file, '{ "colors": ');
  const report = audit([file]);
  const markdown = markdownReport(report);
  assert.match(markdown, /\*\*Result: ERROR\. 1 theme: 0 with failures, 0 failures, 1 unreadable/);
  assert.match(markdown, /\*\*ERROR:\*\* VS Code cannot parse this JSON/);
  assert.equal(exitCode(report), 2);
});

test('strict Markdown shows missing checks and the real variety results', () => {
  const strict = markdownReport(audit(['test/data/oracle-extension/themes/dark.json'], true));
  assert.match(strict, /Mode: strict \(rules of 365 Day & Night\)/);
  assert.match(strict, /\| MISSING \| Required key&#58;/);
  const passing = markdownReport(audit(['test/data/365'], true));
  assert.match(passing, /\*\*Result: PASS\. 48 themes: 0 with failures, 0 failures, 0 unreadable/);
  assert.match(passing, /## Variety:/);
  assert.match(passing, /12 themes compared\. 0 variety failures/);
  assert.match(passing, /Every pair of themes stays distinct/);
});

test('all theme, path, error, warning, configuration and exception text stays inert in GitHub Markdown', () => {
  const report = audit(['test/data/oracle-extension/themes/dark.json']);
  const attack = '<img src=x onerror=alert(1)> ![image](https://example.org) `code` | next\n## heading @someone & &#64;team';
  const theme = report.themes[0];
  assert.ok(theme);
  theme.label = attack;
  theme.file = attack;
  theme.config = attack;
  theme.warnings.push(attack);
  report.warnings.push(attack);
  const check = theme.checks?.find((entry) => entry.status === 'fail');
  assert.ok(check);
  check.label = attack;
  check.ignored = attack;
  const markdown = markdownReport(report);
  assert.doesNotMatch(markdown, /<img|!\[image\]|`code`|\| next|\n## heading|@someone|&#64;team|https:/);
  assert.match(markdown, /&#60;img/);
  assert.match(markdown, /&#64;\u200Bsomeone/);
  assert.match(markdown, /&#38; &#38;&#35;64&#59;team/);
  assert.match(markdown, / ↵ &#35;&#35; heading/);
  theme.error = attack;
  assert.doesNotMatch(markdownReport(report), /<img|@someone|https:/);
});

test('strict variety failures remain visible and count in the global result', () => {
  const folder = join(temp, 'duplicates');
  mkdirSync(folder);
  const theme = new URL('test/data/365/themes/365-01-dark-theme.json', ROOT);
  cpSync(theme, join(folder, 'one.json'));
  cpSync(theme, join(folder, 'two.json'));
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ contributes: { themes: [
    { label: 'One', path: './one.json', uiTheme: 'vs-dark' },
    { label: 'Two', path: './two.json', uiTheme: 'vs-dark' },
  ] } }));
  const report = audit([folder], true);
  assert.ok(report.variety.some((variety) => variety.failures.length > 0));
  const markdown = markdownReport(report);
  assert.match(markdown, /\*\*Result: FAIL/);
  assert.match(markdown, /## Variety:/);
  assert.match(markdown, /- \*\*FAIL:\*\* editor&#46;background/);
  assert.ok(markdown.includes(`${String(report.summary.failures)} failures, 0 unreadable.`));
});

test('a large report is bounded in UTF-8 bytes, ends between complete lines, and announces omitted details', () => {
  const report = audit(['test/data/oracle-extension/themes/dark.json']);
  const theme = report.themes[0];
  assert.ok(theme);
  const check = { label: 'A failing check with é and 漢字', status: 'fail', value: 1, minimum: 4.5 } as const;
  theme.checks = Array.from({ length: 10_000 }, () => ({ ...check }));
  theme.distinctions = [];
  theme.summary = { checks: 10_000, failed: 10_000, missing: 0, information: 0, pairs: 0, confused: 0, ignored: 0 };
  report.summary.failures = 10_000;
  const markdown = markdownReport(report);
  assert.ok(Buffer.byteLength(markdown) <= 60_000);
  assert.match(markdown, /1 theme: 1 with failures, 10000 failures, 0 unreadable/);
  assert.match(markdown, /\n\*\*Details truncated:\*\*.*complete audit.*`--json`.*\n$/);
  assert.ok(markdown.includes('A failing check with é and 漢字'));
  assert.doesNotMatch(markdown, /\uFFFD/);
  for (const line of markdown.split('\n').filter((line) => line.startsWith('| FAIL |'))) {
    assert.ok(line.endsWith(' |'), 'truncation split a table row');
  }
});
