// The configuration of an audit, `.vscode-theme-audit.json` in the extension folder or given with --config: the four
// reference thresholds, and the checks or pairs to ignore, each with a reason that the report shows. Described by
// schema/config-v1.schema.json.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Check, Distinction, ThemeAudit } from './audit.ts';
import type { View } from './simulation.ts';
import { MIN_DELTA_E_2000 } from './audit.ts';
import { ThemeError, readJsonc } from './theme.ts';

/** The name of the configuration file in an extension folder. */
export const CONFIG_FILE = '.vscode-theme-audit.json';

/** The four reference thresholds and their defaults: WCAG 2.2 for contrast, a project rule for color blindness. */
export interface Thresholds {
  /** Contrast of text: 4.5:1, WCAG 2.2 AA (1.4.3). The checks whose minimum is 4.5 use it. */
  text: number;
  /** Contrast of text in high contrast themes and of the main text in strict mode: 7:1, WCAG 2.2 AAA (1.4.6). */
  enhancedText: number;
  /** Contrast of indicators, borders, icons and lines: 3:1, WCAG 2.2 (1.4.11). The checks whose minimum is 3. */
  nonText: number;
  /** CIEDE2000 difference under which two colors that must stay distinct are confused: 7, a project rule. */
  deltaE2000: number;
}

export const DEFAULT_THRESHOLDS: Readonly<Thresholds> = { text: 4.5, enhancedText: 7, nonText: 3, deltaE2000: MIN_DELTA_E_2000 };

const VIEWS: readonly View[] = ['normal', 'protan', 'deutan', 'tritan'];

/** A check or a pair to ignore, in one theme or in all, with the reason that the report shows. */
export type Exception =
  | { check: string; theme?: string; reason: string }
  | { pair: [string, string]; view?: View; theme?: string; reason: string };

export interface Config {
  /** The configuration file. */
  file: string;
  thresholds: Thresholds;
  ignore: Exception[];
}

function fail(file: string, message: string): never {
  throw new ThemeError(file, `invalid configuration: ${message}`);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function readException(file: string, value: unknown, index: number): Exception {
  const where = `ignore[${String(index)}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(file, `${where} must be an object`);
  const entry = value as Record<string, unknown>;
  for (const key of Object.keys(entry)) {
    if (!['check', 'pair', 'view', 'theme', 'reason'].includes(key)) fail(file, `${where} has an unknown key "${key}"`);
  }
  if (!isText(entry.reason)) fail(file, `${where} needs a reason, a text that the report shows`);
  if (entry.theme !== undefined && !isText(entry.theme)) fail(file, `${where}.theme must be the name of a theme`);
  const theme = entry.theme === undefined ? {} : { theme: entry.theme };
  if (entry.check !== undefined) {
    if (entry.pair !== undefined || entry.view !== undefined) fail(file, `${where} names a check or a pair, not both`);
    if (!isText(entry.check)) fail(file, `${where}.check must be the label of a check`);
    return { check: entry.check, ...theme, reason: entry.reason };
  }
  if (entry.pair !== undefined) {
    const pair = entry.pair;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(isText)) fail(file, `${where}.pair must be two names, such as ["keyword", "function"]`);
    if (entry.view !== undefined && !VIEWS.includes(entry.view as View)) fail(file, `${where}.view must be ${VIEWS.join(', ')}`);
    const view = entry.view === undefined ? {} : { view: entry.view as View };
    return { pair: [pair[0] as string, pair[1] as string], ...view, ...theme, reason: entry.reason };
  }
  return fail(file, `${where} needs a check or a pair`);
}

/** Reads a configuration file; a ThemeError when it cannot be read or is not valid. */
export function loadConfig(file: string): Config {
  let content: unknown;
  try {
    content = readJsonc(file);
  } catch (error) {
    if (error instanceof ThemeError) throw new ThemeError(file, `invalid configuration: ${error.message.slice(file.length + 2)}`);
    throw new ThemeError(file, `cannot be read (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof content !== 'object' || content === null || Array.isArray(content)) fail(file, 'it must be an object');
  const raw = content as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!['$schema', 'thresholds', 'ignore'].includes(key)) fail(file, `unknown key "${key}"`);
  }
  const thresholds = { ...DEFAULT_THRESHOLDS };
  if (raw.thresholds !== undefined) {
    if (typeof raw.thresholds !== 'object' || raw.thresholds === null || Array.isArray(raw.thresholds)) fail(file, 'thresholds must be an object');
    for (const [key, value] of Object.entries(raw.thresholds)) {
      if (!(key in DEFAULT_THRESHOLDS)) fail(file, `unknown threshold "${key}" (${Object.keys(DEFAULT_THRESHOLDS).join(', ')})`);
      const [min, max] = key === 'deltaE2000' ? [0, 100] : [1, 21];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(file, `thresholds.${key} must be a number from ${String(min)} to ${String(max)}`);
      thresholds[key as keyof Thresholds] = value;
    }
  }
  if (raw.ignore !== undefined && !Array.isArray(raw.ignore)) fail(file, 'ignore must be a list');
  const ignore = ((raw.ignore ?? []) as unknown[]).map((entry, index) => readException(file, entry, index));
  return { file, thresholds, ignore };
}

/**
 * The configuration of an extension folder or of a theme file: `.vscode-theme-audit.json` in the folder, or in a
 * folder above the file up to the extension folder (the one with a package.json). Undefined when there is none.
 */
export function findConfig(path: string, isFolder: boolean): string | undefined {
  for (let folder = isFolder ? path : dirname(path); ; folder = dirname(folder)) {
    const file = join(folder, CONFIG_FILE);
    if (existsSync(file)) return file;
    if (existsSync(join(folder, 'package.json')) || dirname(folder) === folder) return undefined;
  }
}

/** Warnings for the thresholds that a configuration lowers: the report then no longer follows WCAG or the rule. */
export function loweredThresholds(config: Config): string[] {
  const names: Record<keyof Thresholds, string> = {
    text: 'text (WCAG 2.2 AA)', enhancedText: 'enhanced text (WCAG 2.2 AAA)', nonText: 'non-text elements (WCAG 2.2)',
    deltaE2000: 'colors that must stay distinct (CIEDE2000)',
  };
  return (Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[])
    .filter((key) => config.thresholds[key] < DEFAULT_THRESHOLDS[key])
    .map((key) => `the configuration lowers the minimum for ${names[key]} from ${String(DEFAULT_THRESHOLDS[key])} to ${String(config.thresholds[key])}`);
}

/** The minimum of a check once the thresholds apply: 4.5, 7 and 3 are the three contrast thresholds of WCAG. */
function minimumWith(minimum: number | string, thresholds: Thresholds): number | string {
  if (minimum === DEFAULT_THRESHOLDS.text) return thresholds.text;
  if (minimum === DEFAULT_THRESHOLDS.enhancedText) return thresholds.enhancedText;
  if (minimum === DEFAULT_THRESHOLDS.nonText) return thresholds.nonText;
  return minimum;
}

const samePair = (a: readonly string[], b: readonly string[]) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** What the exceptions of a configuration did, over every theme: those that named something, and those that kept a failure out. */
export interface ExceptionUse {
  used: Set<Exception>;
  needed: Set<Exception>;
}

/**
 * The audit of one theme with a configuration: the thresholds replace the minimums 4.5, 7 and 3 of the checks and
 * the CIEDE2000 minimum of the pairs, and each check or pair that an exception names gets `ignored`, its reason.
 * `use` records which exceptions named something, and which of them named a failure (a missing color in strict mode
 * too), so that the report can point out the others.
 */
export function applyConfig(audit: ThemeAudit, config: Config, themeLabel: string, use: ExceptionUse, strict = false): ThemeAudit {
  const { thresholds } = config;
  const applies = (exception: Exception) => exception.theme === undefined || exception.theme === themeLabel;
  const checks = audit.checks.map((check): Check => {
    const minimum = minimumWith(check.minimum, thresholds);
    let result: Check = check;
    if (minimum !== check.minimum && typeof minimum === 'number' && check.value !== null) {
      result = { ...check, minimum, status: check.value >= minimum ? 'pass' : 'fail' };
    } else if (minimum !== check.minimum) {
      result = { ...check, minimum };
    }
    const exception = config.ignore.find((e) => 'check' in e && e.check === check.label && applies(e));
    if (!exception) return result;
    use.used.add(exception);
    if (result.status === 'fail' || (strict && result.status === 'missing')) use.needed.add(exception);
    return { ...result, ignored: exception.reason };
  });
  const distinctions = audit.distinctions.map((pair): Distinction => {
    const result: Distinction = { ...pair, status: pair.deltaE2000 >= thresholds.deltaE2000 ? 'pass' : 'fail' };
    const exception = config.ignore.find((e) => 'pair' in e && samePair(e.pair, pair.pair) && (e.view === undefined || e.view === pair.view) && applies(e));
    if (!exception) return result;
    use.used.add(exception);
    if (result.status === 'fail') use.needed.add(exception);
    return { ...result, ignored: exception.reason };
  });
  return { ...audit, checks, distinctions };
}

/** How the report names an exception in a warning. */
export function exceptionName(exception: Exception): string {
  const what = 'check' in exception ? `the check "${exception.check}"` : `the pair ${exception.pair.join(' / ')}${exception.view ? ` (${exception.view})` : ''}`;
  return exception.theme === undefined ? what : `${what} of the theme "${exception.theme}"`;
}
