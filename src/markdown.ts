// A bounded GitHub Markdown report for job summaries and pull request comments. JSON keeps every result.

import type { Check, Distinction } from './audit.ts';
import { exitCode } from './report.ts';
import type { Report, ThemeReport } from './report.ts';

const MAX_BYTES = 60_000;
const TRUNCATED = '\n**Details truncated:** this report is limited to 60,000 UTF-8 bytes. The totals above cover the complete audit. Use `--json` or `--format json` for every result.\n';

/**
 * Untrusted text stays text in Markdown, HTML and table cells. A zero-width space after @ also prevents a PR
 * comment from notifying a person or team named by a theme, warning or exception reason.
 */
function text(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029') return ' ↵ ';
    if (character === '\t') return ' ';
    if (code < 32 || code === 127) return '\uFFFD';
    if (character === '@') return '&#64;\u200B';
    // Encoding ASCII punctuation prevents links, images, HTML, code spans and table delimiters from appearing.
    if ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)) {
      return `&#${String(code)};`;
    }
    return character;
  }).join('');
}

function measured(value: number | null, digits: number): string {
  return value === null ? '—' : value.toFixed(digits);
}

/** Checks displayed as failures or exceptions, using the same rules as the text report. */
function wouldFail(check: Check, strict: boolean): boolean {
  return check.information !== true && (check.status === 'fail' || (strict && check.status === 'missing'));
}

function* checkLines(checks: readonly Check[], strict: boolean): Generator<string> {
  const failures = checks.filter((check) => wouldFail(check, strict));
  if (failures.length === 0) return;
  yield '';
  yield '### Checks';
  yield '';
  yield '| Result | Check | Colors | Measured | Minimum | Reason |';
  yield '| --- | --- | --- | --- | --- | --- |';
  for (const check of failures) {
    const status = check.ignored === undefined ? (check.status === 'missing' ? 'MISSING' : 'FAIL') : 'IGNORED';
    yield `| ${status} | ${text(check.label)} | ${text(check.colors?.join(' on ') ?? '—')} | ${measured(check.value, 2)} | ${text(String(check.minimum))} | ${check.ignored === undefined ? '—' : text(check.ignored)} |`;
  }
}

function* pairLines(pairs: readonly Distinction[], minimum: number): Generator<string> {
  const groups = new Map<string, Distinction[]>();
  for (const pair of pairs) {
    if (pair.status !== 'fail') continue;
    // Keep ignored visions apart from failures, even when they belong to the same pair.
    const key = JSON.stringify([pair.pair, pair.ignored !== undefined]);
    const group = groups.get(key);
    if (group) group.push(pair);
    else groups.set(key, [pair]);
  }
  if (groups.size === 0) return;
  yield '';
  yield '### Color distinctions';
  yield '';
  yield `CIEDE2000 minimum: ${String(minimum)}. Each pair lists the visions where it falls below the minimum.`;
  yield '';
  yield '| Result | Pair | Colors | Visions: ΔE2000 (model) | Reason |';
  yield '| --- | --- | --- | --- | --- |';
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const status = first.ignored === undefined ? 'CONFUSED' : 'IGNORED';
    const visions = group.map((pair) => `${pair.view}: ${measured(pair.deltaE2000, 1)}${pair.model ? ` (${pair.model})` : ''}`).join('; ');
    const reasons = [...new Set(group.flatMap((pair) => pair.ignored === undefined ? [] : [pair.ignored]))];
    yield `| ${status} | ${text(first.pair.join(' / '))} | ${text(first.colors.join(' / '))} | ${text(visions)} | ${reasons.length === 0 ? '—' : text(reasons.join('; '))} |`;
  }
}

function* themeLines(theme: ThemeReport, report: Report): Generator<string> {
  yield '';
  yield `## ${text(theme.label)} (${text(theme.uiTheme)})`;
  yield '';
  yield `File: ${text(theme.file)}`;
  for (const warning of theme.warnings) yield `- **WARNING:** ${text(warning)}`;
  if (theme.config !== undefined) {
    yield '';
    yield `Configuration: ${text(theme.config)}`;
    if (theme.thresholds) {
      const limits = theme.thresholds;
      yield `Thresholds: text ${String(limits.text)}, enhanced text ${String(limits.enhancedText)}, non-text ${String(limits.nonText)}, ΔE2000 ${String(limits.deltaE2000)}.`;
    }
  }
  if (theme.error !== undefined) {
    yield '';
    yield `**ERROR:** ${text(theme.error)}`;
    return;
  }
  const { summary, checks = [], distinctions = [], achromatopsia = [] } = theme;
  if (!summary) return;
  yield '';
  yield `${String(summary.checks)} checks: ${String(summary.failed)} failed. ${String(summary.pairs)} color pairs across visions: ${String(summary.confused)} confused. ${String(summary.ignored)} ignored by the configuration.`;
  const minimum = theme.thresholds?.deltaE2000 ?? report.minimumDeltaE2000;
  const grays = achromatopsia.filter((pair) => pair.deltaE2000 < minimum).length;
  yield `Information: ${String(summary.missing)} colors that VS Code does not show; ${String(summary.information)} missing styles of WCAG 1.4.1; achromatopsia ${String(grays)} of ${String(achromatopsia.length)} pairs under ${String(minimum)}. Information does not count as a failure.`;
  yield* checkLines(checks, report.strict);
  yield* pairLines(distinctions, minimum);
}

function* reportLines(report: Report): Generator<string> {
  const { themes, themesWithFailures, failures, unreadable } = report.summary;
  const status = ['PASS', 'FAIL', 'ERROR'][exitCode(report)] ?? 'ERROR';
  yield '# vscode-theme-audit';
  yield '';
  // These complete totals precede every untrusted field and every list that may be truncated.
  yield `**Result: ${status}. ${String(themes)} theme${themes === 1 ? '' : 's'}: ${String(themesWithFailures)} with failures, ${String(failures)} failure${failures === 1 ? '' : 's'}, ${String(unreadable)} unreadable.**`;
  yield '';
  yield `Tool version: ${text(report.tool.version)}. Colors of VS Code ${text(report.vscode.version)} (${text(report.vscode.commit)}).`;
  yield report.strict ? 'Mode: strict (rules of 365 Day & Night).' : 'Mode: general.';
  if (report.warnings.length > 0) {
    yield '';
    yield '## Warnings';
    yield '';
    for (const warning of report.warnings) yield `- **WARNING:** ${text(warning)}`;
  }
  yield '';
  yield '## Themes';
  yield '';
  yield '| Theme | Type | Failed checks | Confused pairs | Ignored | Unreadable |';
  yield '| --- | --- | ---: | ---: | ---: | ---: |';
  for (const theme of report.themes) {
    const summary = theme.summary;
    yield `| ${text(theme.label)} | ${text(theme.uiTheme)} | ${summary ? String(summary.failed) : '—'} | ${summary ? String(summary.confused) : '—'} | ${summary ? String(summary.ignored) : '—'} | ${theme.error === undefined ? '0' : '1'} |`;
  }
  for (const theme of report.themes) yield* themeLines(theme, report);
  for (const variety of report.variety) {
    yield '';
    yield `## Variety: ${text(variety.folder)} (${text(variety.uiTheme)})`;
    yield '';
    yield `${String(variety.themes.length)} themes compared. ${String(variety.failures.length)} variety failures.`;
    if (variety.failures.length === 0) yield 'Every pair of themes stays distinct.';
    for (const failure of variety.failures) yield `- **FAIL:** ${text(failure)}`;
  }
}

/**
 * The GitHub Markdown report, at most 60,000 UTF-8 bytes so it fits both a PR comment and a job summary. Complete
 * global totals are always shown. Omitted details are announced; JSON is the complete machine-readable report.
 */
export function markdownReport(report: Report): string {
  const lines: string[] = [];
  let bytes = 0;
  // Reserve the notice even when the last line would otherwise fit: it must never be lost to the size limit.
  const budget = MAX_BYTES - Buffer.byteLength(TRUNCATED);
  for (const line of reportLines(report)) {
    const size = Buffer.byteLength(line) + 1;
    if (bytes + size > budget) return lines.join('\n') + '\n' + TRUNCATED;
    lines.push(line);
    bytes += size;
  }
  return lines.join('\n') + '\n';
}
