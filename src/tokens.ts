// The color of a token in a theme, as VS Code shows it with TextMate grammars: the rules that VS Code gives to
// vscode-textmate (tokenColors in colorThemeData.ts of microsoft/vscode 1.147.0), then the matching of
// src/textmate.ts.
// Copyright (c) Microsoft Corporation for the rules of VS Code. Licensed under the MIT License: see THIRD-PARTY-NOTICES.md.

import { WorkbenchColors } from './colors.ts';
import { parse, toHex } from './color.ts';
import { FontStyle, TextMateTheme } from './textmate.ts';
import type { RawRule } from './textmate.ts';
import { THEME_TYPES } from './theme.ts';
import type { Theme, ThemeType, UiTheme } from './theme.ts';

/** Colors of log files that VS Code adds after the rules of a theme that does not set token.info-token. */
const DEFAULT_TOKEN_RULES: Readonly<Record<ThemeType, readonly RawRule[]>> = {
  light: [
    { scope: 'token.info-token', settings: { foreground: '#316bcd' } },
    { scope: 'token.warn-token', settings: { foreground: '#cd9731' } },
    { scope: 'token.error-token', settings: { foreground: '#cd3131' } },
    { scope: 'token.debug-token', settings: { foreground: '#800080' } },
  ],
  dark: [
    { scope: 'token.info-token', settings: { foreground: '#6796e6' } },
    { scope: 'token.warn-token', settings: { foreground: '#cd9731' } },
    { scope: 'token.error-token', settings: { foreground: '#f44747' } },
    { scope: 'token.debug-token', settings: { foreground: '#b267e6' } },
  ],
  hcLight: [
    { scope: 'token.info-token', settings: { foreground: '#316bcd' } },
    { scope: 'token.warn-token', settings: { foreground: '#cd9731' } },
    { scope: 'token.error-token', settings: { foreground: '#cd3131' } },
    { scope: 'token.debug-token', settings: { foreground: '#800080' } },
  ],
  hcDark: [
    { scope: 'token.info-token', settings: { foreground: '#6796e6' } },
    { scope: 'token.warn-token', settings: { foreground: '#008000' } },
    { scope: 'token.error-token', settings: { foreground: '#FF0000' } },
    { scope: 'token.debug-token', settings: { foreground: '#b267e6' } },
  ],
};

/**
 * A color of a TextMate rule as VS Code passes it to vscode-textmate (normalizeColor): uppercase, '#RGB' and '#RGBA'
 * written in full, and nothing for a value that is not a hexadecimal color.
 */
export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('#') || ![4, 5, 7, 9].includes(value.length)) return undefined;
  const digits = value.slice(1).toUpperCase();
  if (!/^[0-9A-F]+$/.test(digits)) return undefined;
  return '#' + (digits.length <= 4 ? digits.replace(/./g, '$&$&') : digits);
}

/** A workbench color as VS Code writes it back (Color, then formatHexA with compact): '#RRGGBB', or '#RRGGBBAA'. */
export function workbenchColor(value: string): string {
  const { rgb, alpha } = parse(value);
  const a = Math.round(alpha * 255);
  return a === 255 ? toHex(rgb) : toHex(rgb) + a.toString(16).padStart(2, '0').toUpperCase();
}

/** The TextMate rules that VS Code gives to vscode-textmate for a theme. */
export function textMateRules(theme: Theme, type: ThemeType): RawRule[] {
  // The editor colors of the theme, or their defaults: in High Contrast Light, the default of editor.foreground is
  // the color `foreground` of the theme
  const colors = new WorkbenchColors(theme, type);
  // The default rule (no scope) is always first; the default rules of the theme itself are ignored
  const rules: RawRule[] = [{
    settings: {
      foreground: normalizeColor(colors.color('editor.foreground')?.toHex()),
      background: normalizeColor(colors.color('editor.background')?.toHex()),
    },
  }];
  const add = (rule: RawRule) => {
    if (!rule.scope || !rule.settings) return;
    rules.push({
      scope: rule.scope,
      settings: {
        foreground: normalizeColor(rule.settings.foreground),
        background: normalizeColor(rule.settings.background),
        fontStyle: rule.settings.fontStyle,
      },
    });
  };
  theme.tokenColors.forEach(add);
  if (!theme.tokenColors.some((rule) => rule.scope === 'token.info-token' && rule.settings)) DEFAULT_TOKEN_RULES[type].forEach(add);
  return rules;
}

export interface TokenStyle {
  foreground: string;
  background: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
  strikethrough: boolean;
}

/** Colors of the tokens of a theme, as VS Code shows them with TextMate grammars (without semantic tokens). */
export class TokenColors {
  readonly type: ThemeType;
  private readonly textMate: TextMateTheme;

  constructor(theme: Theme, uiTheme: UiTheme) {
    this.type = THEME_TYPES[uiTheme];
    this.textMate = new TextMateTheme(textMateRules(theme, this.type));
  }

  /** Style of a token, from its scopes, outermost first: ['source.ts', 'meta.block.ts', 'keyword.control.ts']. */
  style(scopes: readonly string[]): TokenStyle {
    const { fontStyle, foreground, background } = this.textMate.resolve(scopes);
    const has = (flag: number) => fontStyle !== FontStyle.NotSet && (fontStyle & flag) !== 0;
    return {
      foreground, background,
      italic: has(FontStyle.Italic), bold: has(FontStyle.Bold),
      underline: has(FontStyle.Underline), strikethrough: has(FontStyle.Strikethrough),
    };
  }
}
