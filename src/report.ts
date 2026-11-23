// The report of the command: the audit of theme files and extension folders, as a versioned JSON document for CI
// (schema/report-v1.schema.json) or as a text for people, and the exit code.

import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { MIN_DELTA_E_2000, auditTheme, auditVariety, isFailure, varietyFailures } from './audit.ts';
import type { Check, Distinction, ThemeAudit, Variety } from './audit.ts';
import { extensionColors } from './colors.ts';
import { DEFAULT_THRESHOLDS, applyConfig, exceptionName, findConfig, loadConfig, loweredThresholds } from './config.ts';
import type { Config, ExceptionUse, Thresholds } from './config.ts';
import type { ColorRegistry } from './colors.ts';
import { downloadOpenVsx, isOpenVsxInput, openVsxLabel, parseOpenVsxInput } from './open-vsx.ts';
import type { Fetcher } from './open-vsx.ts';
import { ThemeError, extensionThemes, loadTheme, readJsonc } from './theme.ts';
import type { ThemeWarning, UiTheme } from './theme.ts';
import { VSCODE_COLORS, VSCODE_SOURCE } from './vscode-colors.ts';
import { extractVsix } from './vsix.ts';

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
  /** Checks and pairs that would fail, but that the configuration ignores, each with its reason. */
  ignored: number;
}

export interface ThemeReport {
  label: string;
  /**
   * The theme file, relative to the folder where the command runs. In a .vsix, the path of the .vsix then the path
   * inside it (`my-theme-1.2.3.vsix/extension/themes/dark.json`); for an extension of Open VSX, its id and version
   * (`open-vsx:publisher.name@1.2.3/extension/themes/dark.json`).
   */
  file: string;
  uiTheme: UiTheme;
  /** What VS Code accepts but the author probably did not mean, such as a color it shows in red. */
  warnings: string[];
  /** The configuration file that applies to this theme, if any. */
  config?: string;
  /** The thresholds of that configuration, when they differ from the defaults. */
  thresholds?: Thresholds;
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

/** How the report names a file: relative to the folder where the command runs, or inside a .vsix. */
type Display = (file: string) => string;

function relativeDisplay(cwd: string): Display {
  return (file) => (relative(cwd, file) || basename(file)).split(sep).join('/');
}

/** The files of an extracted .vsix, named by the .vsix or the Open VSX id, then their path inside it. */
function vsixDisplay(root: string, prefix: string, outside: Display): Display {
  return (file) => {
    const inside = relative(root, file);
    if (inside === '') return prefix;
    if (inside.startsWith('..') || isAbsolute(inside)) return outside(file);
    return `${prefix}/${inside.split(sep).join('/')}`;
  };
}

function warningText(warning: ThemeWarning, show: Display): string {
  return warning.file ? `${show(warning.file)}: ${warning.message}` : warning.message;
}

/** The themes of an extension folder, with the colors that the extension contributes. */
function folderTargets(folder: string, show: Display, warnings: string[]): Target[] {
  const { themes, warnings: manifestWarnings } = extensionThemes(folder);
  const { colors, warnings: colorWarnings } = extensionColors(folder);
  warnings.push(...[...manifestWarnings, ...colorWarnings].map((w) => warningText(w, show)));
  const registry = { ...VSCODE_COLORS, ...colors };
  return themes.map((theme) => ({ label: theme.label, file: theme.path, uiTheme: theme.uiTheme, registry, warnings: [] }));
}

/**
 * A theme file: its type and label come from the extension that contributes it, the nearest package.json above
 * it. Without one, the type comes from the `type` of the file, and VS Code would show it as dark otherwise.
 */
function fileTarget(file: string, show: Display, warnings: string[]): Target {
  for (let folder = dirname(file); ; folder = dirname(folder)) {
    if (existsSync(resolve(folder, 'package.json'))) {
      try {
        const extensionWarnings: string[] = [];
        const target = folderTargets(folder, show, extensionWarnings).find((t) => t.file === file);
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
  else target.warnings.push(`${show(file)}: no extension declares this theme and its 'type' is missing or unknown: audited as dark (vs-dark), as VS Code shows it`);
  return target;
}

function summarize(audit: ThemeAudit, strict: boolean): ThemeSummary {
  return {
    checks: audit.checks.length,
    failed: audit.checks.filter((c) => isFailure(c, strict)).length,
    missing: strict ? 0 : audit.checks.filter((c) => c.status === 'missing').length,
    information: audit.checks.filter((c) => c.information === true && c.status !== 'pass').length,
    pairs: audit.distinctions.length,
    confused: audit.distinctions.filter((d) => isFailure(d)).length,
    ignored: [...audit.checks, ...audit.distinctions]
      .filter((c) => c.ignored !== undefined && (c.status === 'fail' || (strict && c.status === 'missing'))).length,
  };
}

interface Entry {
  /** An absolute path: a theme file, or an extension folder (an extracted .vsix too). */
  path: string;
  show: Display;
}

export interface AuditPathOptions {
  /** The rules of 365 Day & Night (--strict). */
  strict?: boolean;
  /** The version of the package, written in the report. */
  version: string;
  /** The folder that paths are relative to (the current folder by default). */
  cwd?: string;
  /**
   * A configuration file for every input (--config). Without it, each extension folder uses its own
   * .vscode-theme-audit.json, if it has one.
   */
  config?: string;
}

/**
 * The audit of theme files and extension folders. A folder that cannot be read as an extension with themes throws
 * a ThemeError; a theme that cannot be read is reported with its error. A .vsix file or an Open VSX id needs
 * auditInputs().
 */
export function auditPaths(paths: readonly string[], options: AuditPathOptions): Report {
  const cwd = options.cwd ?? process.cwd();
  const show = relativeDisplay(cwd);
  return auditEntries(paths.map((path) => ({ path: resolve(cwd, path), show })), options, cwd);
}

/** Whether a path names a .vsix file. */
function isVsixFile(path: string): boolean {
  return extname(path).toLowerCase() === '.vsix' && existsSync(path) && statSync(path).isFile();
}

/**
 * The audit of what the command takes: theme files, extension folders, .vsix files and Open VSX ids
 * (`open-vsx:publisher.name[@version]`, downloaded with `fetcher`). Each .vsix is extracted into a temporary
 * folder, deleted at the end. A .vsix or an Open VSX id that cannot be read throws a ThemeError, like a missing path.
 */
export async function auditInputs(inputs: readonly string[], options: AuditPathOptions & { fetcher?: Fetcher }): Promise<Report> {
  const cwd = options.cwd ?? process.cwd();
  const show = relativeDisplay(cwd);
  const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-'));
  try {
    const entries: Entry[] = [];
    for (const [index, input] of inputs.entries()) {
      const folder = join(temp, String(index));
      if (isOpenVsxInput(input)) {
        const ref = parseOpenVsxInput(input);
        const { version, data } = await downloadOpenVsx(ref, options.fetcher);
        const file = `${folder}.vsix`;
        writeFileSync(file, data);
        await extractVsix(file, folder);
        entries.push({ path: folder, show: vsixDisplay(folder, `${openVsxLabel(ref, version)}/extension`, show) });
        continue;
      }
      const path = resolve(cwd, input);
      if (isVsixFile(path)) {
        await extractVsix(path, folder);
        entries.push({ path: folder, show: vsixDisplay(folder, `${show(path)}/extension`, show) });
        continue;
      }
      entries.push({ path, show });
    }
    return auditEntries(entries, options, cwd);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function auditEntries(entries: readonly Entry[], options: AuditPathOptions, cwd: string): Report {
  const strict = options.strict === true;
  const warnings: string[] = [];
  const themes: ThemeReport[] = [];
  const variety: VarietyReport[] = [];
  // Each configuration is read once, and reports the exceptions that named nothing once, after every input
  const configs = new Map<string, { config: Config; show: Display; use: ExceptionUse }>();
  const given = options.config === undefined ? undefined : resolve(cwd, options.config);
  if (given !== undefined && !existsSync(given)) throw new ThemeError(given, 'no such configuration file');
  const configFor = (path: string, isFolder: boolean, show: Display) => {
    const file = given ?? findConfig(path, isFolder);
    if (file === undefined) return undefined;
    let found = configs.get(file);
    if (!found) {
      const config = loadConfig(file);
      const name = given === undefined ? show(file) : relativeDisplay(cwd)(file);
      found = { config, show: given === undefined ? show : relativeDisplay(cwd), use: { used: new Set(), needed: new Set() } };
      configs.set(file, found);
      warnings.push(...loweredThresholds(config).map((warning) => `${name}: ${warning}`));
    }
    return found;
  };
  for (const { path: absolute, show } of entries) {
    if (!existsSync(absolute)) throw new ThemeError(absolute, 'no such file or folder');
    const isFolder = statSync(absolute).isDirectory();
    const configuration = configFor(absolute, isFolder, show);
    const targets = isFolder ? folderTargets(absolute, show, warnings) : [fileTarget(absolute, show, warnings)];
    const loaded: { name: string; uiTheme: UiTheme; theme: ReturnType<typeof loadTheme> }[] = [];
    for (const target of targets) {
      const entry: ThemeReport = { label: target.label, file: show(target.file), uiTheme: target.uiTheme, warnings: [...target.warnings] };
      themes.push(entry);
      let theme;
      try {
        theme = loadTheme(target.file);
      } catch (error) {
        if (!(error instanceof ThemeError)) throw error;
        entry.error = error.message.startsWith(`${target.file}: `) ? error.message.slice(target.file.length + 2) : error.message;
        continue;
      }
      entry.warnings.push(...theme.warnings.map((w) => warningText(w, show)));
      let result = auditTheme(theme, target.uiTheme, { strict, registry: target.registry });
      if (configuration) {
        const { config } = configuration;
        result = applyConfig(result, config, target.label, configuration.use, strict);
        entry.config = configuration.show(config.file);
        if (JSON.stringify(config.thresholds) !== JSON.stringify(DEFAULT_THRESHOLDS)) entry.thresholds = config.thresholds;
      }
      Object.assign(entry, { summary: summarize(result, strict), ...result });
      loaded.push({ name: entry.file, uiTheme: target.uiTheme, theme });
    }
    if (strict && isFolder) {
      for (const result of auditVariety(loaded)) {
        if (result.themes.length > 1) variety.push({ folder: show(absolute), ...result, failures: varietyFailures(result) });
      }
    }
  }
  // Exceptions that no longer keep a failure out: a stale exception would hide the next regression
  for (const { config, show, use } of configs.values()) {
    for (const exception of config.ignore) {
      if (!use.used.has(exception)) warnings.push(`${show(config.file)}: ${exceptionName(exception)} matches nothing: fix its name or remove it`);
      else if (!use.needed.has(exception)) warnings.push(`${show(config.file)}: ${exceptionName(exception)} passes: the exception can be removed`);
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
    const minimumDeltaE2000 = theme.thresholds?.deltaE2000 ?? report.minimumDeltaE2000;
    if (theme.config !== undefined) {
      const t = theme.thresholds;
      lines.push(`  configuration: ${theme.config}${t ? ` (thresholds: text ${String(t.text)}, enhanced text ${String(t.enhancedText)}, non-text ${String(t.nonText)}, ΔE2000 ${String(t.deltaE2000)})` : ''}`);
    }
    // A check that the configuration ignores is shown with its reason, where it would have failed
    const wouldFail = (check: Check) => check.information === undefined && (check.status === 'fail' || (report.strict && check.status === 'missing'));
    for (const check of checks) {
      if (!wouldFail(check)) continue;
      const tag = check.ignored === undefined ? '' : `  (ignored: ${check.ignored})`;
      const kind = check.ignored === undefined ? (check.status === 'missing' ? 'MISSING ' : 'FAIL    ') : 'IGNORED ';
      if (check.status === 'missing') {
        lines.push(`  ${kind} ${check.label}${tag}`);
      } else if (typeof check.minimum === 'string') {
        lines.push(`  ${kind} ${check.label}: expected ${check.minimum}${tag}`);
      } else {
        const colors = check.colors ? `${check.colors[0]} on ${check.colors[1]}  ` : '';
        lines.push(`  ${kind} ${check.label}: ${colors}${number(check.value, 2)} < ${String(check.minimum)}${tag}`);
      }
    }
    // One line per pair of colors, with each vision that confuses it; the ignored ones apart, with their reason
    const confused = new Map<string, Distinction[]>();
    for (const pair of distinctions) {
      if (pair.status !== 'fail') continue;
      const key = `${pair.ignored === undefined ? '' : 'ignored\n'}${pair.pair.join(' / ')}`;
      confused.set(key, [...(confused.get(key) ?? []), pair]);
    }
    for (const pairs of confused.values()) {
      const [first] = pairs;
      if (!first) continue;
      const views = pairs.map((p) => `${p.view} ${number(p.deltaE2000, 1)}${p.model ? ` (${p.model})` : ''}`).join(', ');
      const reasons = [...new Set(pairs.map((p) => p.ignored).filter((r) => r !== undefined))];
      const kind = first.ignored === undefined ? 'CONFUSED' : 'IGNORED ';
      lines.push(`  ${kind} ${first.pair.join(' / ')} (${first.colors.join(' / ')}): ΔE2000 under ${String(minimumDeltaE2000)}: ${views}${reasons.length > 0 ? `  (ignored: ${reasons.join('; ')})` : ''}`);
    }
    const ignoredChecks = checks.filter((c) => c.ignored !== undefined && wouldFail(c)).length;
    const ignoredPairs = summary.ignored - ignoredChecks;
    const parts = [`${String(summary.checks - summary.failed - ignoredChecks)} of ${String(summary.checks)} checks pass`,
      `${String(summary.pairs - summary.confused - ignoredPairs)} of ${String(summary.pairs)} pairs stay distinct`];
    if (summary.ignored > 0) parts.push(`${String(summary.ignored)} ignored by the configuration`);
    if (summary.missing > 0) parts.push(`${String(summary.missing)} colors that VS Code does not show (information)`);
    if (summary.information > 0) parts.push(`${String(summary.information)} styles of WCAG 1.4.1 missing (information)`);
    const grays = achromatopsia.filter((p) => p.deltaE2000 < minimumDeltaE2000).length;
    parts.push(`achromatopsia: ${String(grays)} of ${String(achromatopsia.length)} pairs under ${String(minimumDeltaE2000)} (information)`);
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

