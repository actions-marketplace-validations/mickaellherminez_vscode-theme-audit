// The report of the command: the audit of theme files and extension folders, as a versioned JSON document for CI
// (schema/report-v1.schema.json) or as a text for people, and the exit code.

import { existsSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';

import { MIN_DELTA_E_2000, auditTheme, auditVariety, isFailure, varietyFailures } from './audit.ts';
import type { Check, Distinction, ThemeAudit, Variety } from './audit.ts';
import { extensionColors } from './colors.ts';
import type { ColorRegistry } from './colors.ts';
import { ThemeError, extensionThemes, loadTheme, readJsonc } from './theme.ts';
import type { ThemeWarning, UiTheme } from './theme.ts';
import { VSCODE_COLORS, VSCODE_SOURCE } from './vscode-colors.ts';

/** The version of the JSON format. It changes when a field is removed or changes meaning, not when one is added. */
export const REPORT_FORMAT = 1;

export interface ThemeSummary {
  checks: number;
  /** Checks that fail: a measure under its minimum, or a missing color in strict mode. */
  failed: number;
  /** Colors that VS Code does not show at all, outside strict mode: information. */
  missing: number;
  /** Checks given for information that do not pass, such as the styles of WCAG 1.4.1 outside strict mode. */
  information: number;
  pairs: number;
  /** Pairs of colors that a vision confuses (CIEDE2000 under the minimum). */
  confused: number;
}

export interface ThemeReport {
  label: string;
  /** The theme file, relative to the folder where the command runs. */
  file: string;
  uiTheme: UiTheme;
  /** What VS Code accepts but the author probably did not mean, such as a color it shows in red. */
  warnings: string[];
  /** Why the theme cannot be read: VS Code would not load it, or the package cannot read it yet. */
  error?: string;
  summary?: ThemeSummary;
  checks?: Check[];
  distinctions?: Distinction[];
  achromatopsia?: ThemeAudit['achromatopsia'];
}

export interface VarietyReport extends Variety {
  /** The extension folder. */
  folder: string;
  failures: string[];
}

export interface Report {
  format: number;
  tool: { name: string; version: string };
  /** The version of VS Code whose defaults and rules the audit follows. */
  vscode: { version: string; commit: string };
  strict: boolean;
  minimumDeltaE2000: number;
  /** Warnings about the extensions: their manifest and the colors they contribute. */
  warnings: string[];
  themes: ThemeReport[];
  /** In strict mode, for each extension folder: the variety between its themes of each type. */
  variety: VarietyReport[];
  summary: { themes: number; themesWithFailures: number; failures: number; unreadable: number };
}

interface Target {
  label: string;
  file: string;
  uiTheme: UiTheme;
  registry: ColorRegistry;
  warnings: string[];
}

const TYPES: Readonly<Record<string, UiTheme>> = {
  light: 'vs', vs: 'vs', dark: 'vs-dark', 'vs-dark': 'vs-dark', hc: 'hc-black', hcDark: 'hc-black', 'hc-black': 'hc-black',
  hcLight: 'hc-light', 'hc-light': 'hc-light',
};

function display(file: string, cwd: string): string {
  const path = relative(cwd, file) || basename(file);
  return path.split(sep).join('/');
}

function warningText(warning: ThemeWarning, cwd: string): string {
  return warning.file ? `${display(warning.file, cwd)}: ${warning.message}` : warning.message;
}

/** The themes of an extension folder, with the colors that the extension contributes. */
function folderTargets(folder: string, cwd: string, warnings: string[]): Target[] {
  const { themes, warnings: manifestWarnings } = extensionThemes(folder);
  const { colors, warnings: colorWarnings } = extensionColors(folder);
  warnings.push(...[...manifestWarnings, ...colorWarnings].map((w) => warningText(w, cwd)));
  const registry = { ...VSCODE_COLORS, ...colors };
  return themes.map((theme) => ({ label: theme.label, file: theme.path, uiTheme: theme.uiTheme, registry, warnings: [] }));
}

/**
 * A theme file: its type and label come from the extension that contributes it, the nearest package.json above
 * it. Without one, the type comes from the `type` of the file, and VS Code would show it as dark otherwise.
 */
function fileTarget(file: string, cwd: string, warnings: string[]): Target {
  for (let folder = dirname(file); ; folder = dirname(folder)) {
    if (existsSync(resolve(folder, 'package.json'))) {
      try {
        const extensionWarnings: string[] = [];
        const target = folderTargets(folder, cwd, extensionWarnings).find((t) => t.file === file);
        if (target) {
          warnings.push(...extensionWarnings);
          return target;
        }
      } catch {
        // A package.json that is not an extension with themes
      }
      break;
    }
    if (dirname(folder) === folder) break;
  }
  const target: Target = { label: basename(file), file, uiTheme: 'vs-dark', registry: VSCODE_COLORS, warnings: [] };
  let content: unknown;
  try {
    content = readJsonc(file);
  } catch {
    // loadTheme reports the error
    return target;
  }
  const { name, type } = (typeof content === 'object' && content !== null ? content : {}) as { name?: unknown; type?: unknown };
  if (typeof name === 'string' && name) target.label = name;
  const uiTheme = typeof type === 'string' ? TYPES[type] : undefined;
  if (uiTheme) target.uiTheme = uiTheme;
  else target.warnings.push(`${display(file, cwd)}: no extension declares this theme and its 'type' is missing or unknown: audited as dark (vs-dark), as VS Code shows it`);
  return target;
}

function summarize(audit: ThemeAudit, strict: boolean): ThemeSummary {
  return {
    checks: audit.checks.length,
    failed: audit.checks.filter((c) => isFailure(c, strict)).length,
    missing: strict ? 0 : audit.checks.filter((c) => c.status === 'missing').length,
    information: audit.checks.filter((c) => c.information === true && c.status !== 'pass').length,
    pairs: audit.distinctions.length,
    confused: audit.distinctions.filter((d) => d.status === 'fail').length,
  };
}

/**
 * The audit of theme files and extension folders. A folder that cannot be read as an extension with themes throws
 * a ThemeError; a theme that cannot be read is reported with its error.
 */
export function auditPaths(paths: readonly string[], options: { strict?: boolean; version: string; cwd?: string }): Report {
  const strict = options.strict === true;
  const cwd = options.cwd ?? process.cwd();
  const warnings: string[] = [];
  const themes: ThemeReport[] = [];
  const variety: VarietyReport[] = [];
  for (const path of paths) {
    const absolute = resolve(cwd, path);
    if (!existsSync(absolute)) throw new ThemeError(absolute, 'no such file or folder');
    const isFolder = statSync(absolute).isDirectory();
    const targets = isFolder ? folderTargets(absolute, cwd, warnings) : [fileTarget(absolute, cwd, warnings)];
    const loaded: { name: string; uiTheme: UiTheme; theme: ReturnType<typeof loadTheme> }[] = [];
    for (const target of targets) {
      const entry: ThemeReport = { label: target.label, file: display(target.file, cwd), uiTheme: target.uiTheme, warnings: [...target.warnings] };
      themes.push(entry);
      let theme;
      try {
        theme = loadTheme(target.file);
      } catch (error) {
        if (!(error instanceof ThemeError)) throw error;
        entry.error = error.message.startsWith(`${target.file}: `) ? error.message.slice(target.file.length + 2) : error.message;
        continue;
      }
      entry.warnings.push(...theme.warnings.map((w) => warningText(w, cwd)));
      const result = auditTheme(theme, target.uiTheme, { strict, registry: target.registry });
      Object.assign(entry, { summary: summarize(result, strict), ...result });
      loaded.push({ name: entry.file, uiTheme: target.uiTheme, theme });
    }
    if (strict && isFolder) {
      for (const result of auditVariety(loaded)) {
        if (result.themes.length > 1) variety.push({ folder: display(absolute, cwd), ...result, failures: varietyFailures(result) });
      }
    }
  }
  const failing = themes.filter((t) => t.summary && (t.summary.failed > 0 || t.summary.confused > 0));
  return {
    format: REPORT_FORMAT,
    tool: { name: 'vscode-theme-audit', version: options.version },
    vscode: { version: VSCODE_SOURCE.version, commit: VSCODE_SOURCE.commit },
    strict,
    minimumDeltaE2000: MIN_DELTA_E_2000,
    warnings,
    themes,
    variety,
    summary: {
      themes: themes.length,
      themesWithFailures: failing.length,
      failures: failing.reduce((sum, t) => sum + (t.summary?.failed ?? 0) + (t.summary?.confused ?? 0), 0)
        + variety.reduce((sum, v) => sum + v.failures.length, 0),
      unreadable: themes.filter((t) => t.error !== undefined).length,
    },
  };
}

/** 0 when every check passes, 1 when one fails, 2 when a theme cannot be read. */
export function exitCode(report: Report): 0 | 1 | 2 {
  if (report.summary.unreadable > 0) return 2;
  return report.summary.failures > 0 ? 1 : 0;
}

function number(value: number | null, digits: number): string {
  return value === null ? '-' : value.toFixed(digits);
}

/** The text report: for each theme, every failure with its colors, the value and the minimum, then a summary. */
export function textReport(report: Report): string {
  const lines: string[] = [];
  const mode = report.strict ? ', strict mode (rules of 365 Day & Night)' : '';
  lines.push(`vscode-theme-audit ${report.tool.version}, colors of VS Code ${report.vscode.version}${mode}`);
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  for (const theme of report.themes) {
    lines.push('', `${theme.label} (${theme.uiTheme}): ${theme.file}`);
    for (const warning of theme.warnings) lines.push(`  warning: ${warning}`);
    if (theme.error !== undefined) {
      lines.push(`  ERROR    ${theme.error}`);
      continue;
    }
    const { summary, checks = [], distinctions = [], achromatopsia = [] } = theme;
    if (!summary) continue;
    for (const check of checks) {
      if (!isFailure(check, report.strict)) continue;
      if (check.status === 'missing') {
        lines.push(`  MISSING  ${check.label}`);
      } else if (typeof check.minimum === 'string') {
        lines.push(`  FAIL     ${check.label}: expected ${check.minimum}`);
      } else {
        const colors = check.colors ? `${check.colors[0]} on ${check.colors[1]}  ` : '';
        lines.push(`  FAIL     ${check.label}: ${colors}${number(check.value, 2)} < ${String(check.minimum)}`);
      }
    }
    // One line per pair of colors, with each vision that confuses it
    const confused = new Map<string, Distinction[]>();
    for (const pair of distinctions) {
      if (pair.status !== 'fail') continue;
      const key = pair.pair.join(' / ');
      confused.set(key, [...(confused.get(key) ?? []), pair]);
    }
    for (const [key, pairs] of confused) {
      const views = pairs.map((p) => `${p.view} ${number(p.deltaE2000, 1)}${p.model ? ` (${p.model})` : ''}`).join(', ');
      lines.push(`  CONFUSED ${key} (${pairs[0]?.colors.join(' / ') ?? ''}): ΔE2000 under ${String(report.minimumDeltaE2000)}: ${views}`);
    }
    const parts = [`${String(summary.checks - summary.failed)} of ${String(summary.checks)} checks pass`,
      `${String(summary.pairs - summary.confused)} of ${String(summary.pairs)} pairs stay distinct`];
    if (summary.missing > 0) parts.push(`${String(summary.missing)} colors that VS Code does not show (information)`);
    if (summary.information > 0) parts.push(`${String(summary.information)} styles of WCAG 1.4.1 missing (information)`);
    const grays = achromatopsia.filter((p) => p.deltaE2000 < report.minimumDeltaE2000).length;
    parts.push(`achromatopsia: ${String(grays)} of ${String(achromatopsia.length)} pairs under ${String(report.minimumDeltaE2000)} (information)`);
    lines.push(`  ${parts.join('; ')}`);
  }
  for (const result of report.variety) {
    lines.push('', `Variety of ${result.folder}, ${result.uiTheme} (${String(result.themes.length)} themes)`);
    for (const failure of result.failures) lines.push(`  FAIL     ${failure}`);
    if (result.failures.length === 0) lines.push('  every pair of themes stays distinct');
  }
  const { themes, themesWithFailures, failures, unreadable } = report.summary;
  lines.push('', `${String(themes)} theme${themes === 1 ? '' : 's'}: ${String(themesWithFailures)} with failures, ${String(failures)} failure${failures === 1 ? '' : 's'}${unreadable > 0 ? `, ${String(unreadable)} unreadable` : ''}`);
  return lines.join('\n') + '\n';
}

