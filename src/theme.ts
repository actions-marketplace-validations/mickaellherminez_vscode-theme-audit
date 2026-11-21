// Reads a color theme the way VS Code does (src/vs/workbench/services/themes/common/colorThemeData.ts,
// _loadColorTheme, and themeCompatibility.ts, convertSettings; checked on microsoft/vscode 671d82d2d8).
// Copyright (c) Microsoft Corporation for the rules of VS Code. Licensed under the MIT License: see THIRD-PARTY-NOTICES.md.

import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';

/** Base theme of VS Code: light, dark, high contrast dark, high contrast light. */
export type UiTheme = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
export const UI_THEMES: readonly UiTheme[] = ['vs', 'vs-dark', 'hc-black', 'hc-light'];

export interface TokenSettings {
  foreground?: unknown;
  background?: unknown;
  fontStyle?: unknown;
}

/** A TextMate rule as written in `tokenColors`. Its fields are checked when token colors are resolved. */
export interface TextMateRule {
  name?: unknown;
  scope?: unknown;
  settings?: TokenSettings;
}

/** A rule of `semanticTokenColors`: a selector and its style, as written in the theme. */
export interface SemanticRule {
  selector: string;
  style: unknown;
  file: string;
}

/** Something VS Code accepts without an error, but that the theme author probably did not mean. */
export interface ThemeWarning {
  file: string;
  message: string;
}

export interface Theme {
  /** The theme file, then the files it includes, in the order VS Code reads them. */
  files: string[];
  /** Workbench colors after `include` and `"default"`, as written in the theme ('#RRGGBB'...). */
  colors: Record<string, string>;
  /** TextMate rules, those of the included files first. */
  tokenColors: TextMateRule[];
  semanticTokenColors: SemanticRule[];
  semanticHighlighting: boolean;
  warnings: ThemeWarning[];
}

/** A theme that VS Code would refuse to load, or that this package cannot read yet. */
export class ThemeError extends Error {
  readonly file: string;
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'ThemeError';
    this.file = file;
  }
}

/** Value that removes a color set by an included theme. */
const DEFAULT_COLOR = 'default';
/** What VS Code shows for a color it cannot read (Color.fromHex falls back to red). */
export const INVALID_COLOR = '#FF0000';

/** Settings of the old format (a TextMate rule without scope) and the colors VS Code gives them. */
const SETTING_COLORS: Readonly<Record<string, readonly string[]>> = {
  background: ['editor.background'],
  foreground: ['editor.foreground'],
  selection: ['editor.selectionBackground'],
  inactiveSelection: ['editor.inactiveSelectionBackground'],
  selectionHighlightColor: ['editor.selectionHighlightBackground'],
  findMatchHighlight: ['editor.findMatchHighlightBackground', 'peekViewResult.matchHighlightBackground'],
  currentFindMatchHighlight: ['editor.findMatchBackground'],
  hoverHighlight: ['editor.hoverHighlightBackground'],
  wordHighlight: ['editor.wordHighlightBackground'],
  wordHighlightStrong: ['editor.wordHighlightStrongBackground'],
  findRangeHighlight: ['editor.findRangeHighlightBackground'],
  referenceHighlight: ['peekViewEditor.matchHighlightBackground'],
  lineHighlight: ['editor.lineHighlightBackground'],
  rangeHighlight: ['editor.rangeHighlightBackground'],
  caret: ['editorCursor.foreground'],
  invisibles: ['editorWhitespace.foreground'],
  guide: ['editorIndentGuide.background1'],
  activeGuide: ['editorIndentGuide.activeBackground1'],
  ...Object.fromEntries(['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'].flatMap((name) => [
    [`ansi${name}`, [`terminal.ansi${name}`]], [`ansiBright${name}`, [`terminal.ansiBright${name}`]],
  ])),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Line and column (from 1) of an offset in a text. */
function position(text: string, offset: number): string {
  const before = text.slice(0, offset).split('\n');
  return `${String(before.length)}:${String((before.at(-1)?.length ?? 0) + 1)}`;
}

/** Parses JSON with comments, with the options of VS Code: comments and trailing commas are allowed. */
export function readJsonc(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new ThemeError(file, `cannot be read (${(error as Error).message})`);
  }
  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const list = errors.map((e) => `${printParseErrorCode(e.error)} at ${position(text, e.offset)}`).join(', ');
    throw new ThemeError(file, `VS Code cannot parse this JSON: ${list}`);
  }
  return value;
}

/**
 * A color as VS Code reads it (Color.fromHex): '#' and 3, 4, 6 or 8 digits, otherwise red. A character that is not a
 * hexadecimal digit counts as 0. Both cases give a warning.
 */
function readColor(value: string, file: string, key: string, warnings: ThemeWarning[]): string {
  if (!value.startsWith('#') || ![4, 5, 7, 9].includes(value.length)) {
    warnings.push({ file, message: `"${key}" is not a hexadecimal color (${JSON.stringify(value)}): VS Code shows ${INVALID_COLOR}` });
    return INVALID_COLOR;
  }
  const color = '#' + value.slice(1).replace(/[^0-9a-f]/gi, '0');
  if (color !== value) {
    warnings.push({ file, message: `"${key}" has characters that are not hexadecimal digits (${JSON.stringify(value)}): VS Code reads them as 0, ${color}` });
  }
  return color;
}

/** Old format: rules in `settings`; a rule without scope sets workbench colors (convertSettings of VS Code). */
function convertSettings(rules: unknown[], file: string, theme: Theme): void {
  for (const rule of rules) {
    if (!isObject(rule)) continue;
    theme.tokenColors.push(rule);
    if (rule.scope) continue;
    if (!isObject(rule.settings)) {
      rule.settings = {};
      continue;
    }
    const settings = rule.settings;
    for (const key of Object.keys(settings)) {
      const value = settings[key];
      if (typeof value === 'string') {
        for (const colorId of SETTING_COLORS[key] ?? []) theme.colors[colorId] = readColor(value, file, key, theme.warnings);
      }
      if (key !== 'foreground' && key !== 'background' && key !== 'fontStyle') Reflect.deleteProperty(settings, key);
    }
  }
}

function load(file: string, theme: Theme, chain: readonly string[]): void {
  if (chain.includes(file)) throw new ThemeError(file, `includes itself (${[...chain, file].join(' -> ')})`);
  if (extname(file) !== '.json') {
    throw new ThemeError(file, 'TextMate theme files (.tmTheme) are not supported yet');
  }
  theme.files.push(file);
  const content = readJsonc(file);
  if (!isObject(content)) throw new ThemeError(file, 'VS Code expects an object in a JSON theme file');

  if (typeof content.include === 'string') load(resolve(dirname(file), content.include), theme, [...chain, file]);
  if (Array.isArray(content.settings)) {
    convertSettings(content.settings, file, theme);
    return;
  }
  theme.semanticHighlighting ||= Boolean(content.semanticHighlighting);

  const colors = content.colors;
  if (colors !== undefined && colors !== null) {
    if (typeof colors !== 'object') throw new ThemeError(file, "VS Code expects 'colors' to be an object");
    for (const [key, value] of Object.entries(colors)) {
      if (value === DEFAULT_COLOR) {
        Reflect.deleteProperty(theme.colors, key);
      } else if (typeof value === 'string') {
        theme.colors[key] = readColor(value, file, key, theme.warnings);
      } else {
        const kind = value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value === 'object' ? 'an object' : `a ${typeof value}`;
        theme.warnings.push({ file, message: `"${key}" is ${kind}, not a color: VS Code ignores it` });
      }
    }
  }

  const tokenColors = content.tokenColors;
  if (Array.isArray(tokenColors)) {
    theme.tokenColors.push(...tokenColors.filter(isObject));
  } else if (typeof tokenColors === 'string') {
    throw new ThemeError(file, `'tokenColors' points to a TextMate theme file (${tokenColors}), which is not supported yet`);
  } else if (tokenColors) {
    throw new ThemeError(file, "VS Code expects 'tokenColors' to be an array, or a path to a TextMate theme file");
  }

  if (isObject(content.semanticTokenColors)) {
    for (const [selector, style] of Object.entries(content.semanticTokenColors)) theme.semanticTokenColors.push({ selector, style, file });
  }
}

/** Reads a JSON color theme file and the files it includes, as VS Code does. */
export function loadTheme(file: string): Theme {
  const theme: Theme = { files: [], colors: {}, tokenColors: [], semanticTokenColors: [], semanticHighlighting: false, warnings: [] };
  load(resolve(file), theme, []);
  return theme;
}

/** A color theme contributed by an extension (`contributes.themes` of its package.json). */
export interface ThemeContribution {
  label: string;
  uiTheme: UiTheme;
  /** Absolute path of the theme file. */
  path: string;
}

/** The color themes of an extension folder, read from its package.json, with the defaults of VS Code. */
export function extensionThemes(folder: string): { themes: ThemeContribution[]; warnings: ThemeWarning[] } {
  const manifestFile = resolve(folder, 'package.json');
  const manifest = readJsonc(manifestFile);
  if (!isObject(manifest)) throw new ThemeError(manifestFile, 'expected an object');
  const contributes = isObject(manifest.contributes) ? manifest.contributes : {};
  const contributions = contributes.themes;
  const warnings: ThemeWarning[] = [];
  if (!Array.isArray(contributions)) {
    throw new ThemeError(manifestFile, "this extension contributes no color theme ('contributes.themes')");
  }
  // Labels like "%theme.label%" are translated by package.nls.json
  let nls: Record<string, unknown> = {};
  try {
    const content = readJsonc(resolve(folder, 'package.nls.json'));
    if (isObject(content)) nls = content;
  } catch {
    // No translation file: labels stay as written
  }
  const themes: ThemeContribution[] = [];
  for (const contribution of contributions) {
    if (!isObject(contribution) || typeof contribution.path !== 'string' || !contribution.path) {
      warnings.push({ file: manifestFile, message: "a theme has no 'path': VS Code ignores it" });
      continue;
    }
    const path = resolve(folder, contribution.path);
    let uiTheme: UiTheme = 'vs-dark';
    if (UI_THEMES.includes(contribution.uiTheme as UiTheme)) {
      uiTheme = contribution.uiTheme as UiTheme;
    } else {
      warnings.push({ file: manifestFile, message: `${contribution.path}: 'uiTheme' is missing or unknown: VS Code uses vs-dark` });
    }
    let label = typeof contribution.label === 'string' && contribution.label ? contribution.label : contribution.path.split('/').at(-1) ?? contribution.path;
    const key = /^%(.+)%$/.exec(label)?.[1];
    if (key && typeof nls[key] === 'string') label = nls[key];
    themes.push({ label, uiTheme, path });
  }
  return { themes, warnings };
}
