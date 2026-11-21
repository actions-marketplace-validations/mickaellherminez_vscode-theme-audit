// The checks of the audit: WCAG contrast of the text and of the syntax colors, the styles that carry a meaning
// (WCAG 1.4.1), the colors that must stay distinct with color blindness, and, in strict mode, the rules of 365 Day &
// Night. Ported from scripts/themes/audit.py and variety.py of 365 Day & Night, with the same results on its themes.
// The minimum contrast of the terminal is ported from src/common/Color.ts of xterm.js 6.1.0-beta.337, which VS Code
// 1.147.0 uses. Copyright (c) The xterm.js authors. Licensed under the MIT License: see THIRD-PARTY-NOTICES.md.

import { contrast, over } from './color.ts';
import { WorkbenchColors } from './colors.ts';
import type { ColorRegistry } from './colors.ts';
import { deltaE, deltaE2000, lab } from './difference.ts';
import { ACHROMATOPSIA, MACHADO, VIEWS } from './simulation.ts';
import type { Deficiency, Simulation, View } from './simulation.ts';
import { readColor } from './theme.ts';
import type { Theme, UiTheme } from './theme.ts';
import { TokenColors } from './tokens.ts';
import { VSCODE_COLORS } from './vscode-colors.ts';

/** `pass` and `fail` for a measure; `missing` when a color is not there (a failure only in strict mode). */
export type CheckStatus = 'pass' | 'fail' | 'missing';

export interface Check {
  label: string;
  /** Contrast ratio, or ΔE; null for a style, or when a color is missing. */
  value: number | null;
  /** The minimum value, or the style expected ('italic'...). */
  minimum: number | string;
  status: CheckStatus;
  /** Measured for information: never a failure. */
  information?: true;
}

/** Two colors that must stay distinct, and their closest simulation for one vision. */
export interface Distinction {
  view: View;
  pair: [string, string];
  /** The smallest CIEDE2000 difference among the models of this vision. */
  deltaE2000: number;
  /** The model that gives it; null in normal vision. */
  model: string | null;
  /** CIE76 difference with the same model, for information. */
  cie76: number;
  status: 'pass' | 'fail';
}

export interface ThemeAudit {
  checks: Check[];
  distinctions: Distinction[];
  /** Syntax colors without any color (achromatopsia): information only, never a failure. */
  achromatopsia: Omit<Distinction, 'view' | 'model' | 'status'>[];
}

export interface AuditOptions {
  /**
   * The rules of 365 Day & Night: every color that a check uses must be set by the theme (a missing color is a
   * failure, and a default of VS Code does not count), the main text needs 7:1, the styles of WCAG 1.4.1 are
   * required, the terminal is measured without the minimum contrast of VS Code, and the required keys and semantic
   * roles must be there.
   */
  strict?: boolean;
  /** The registered colors: those of VS Code by default, plus those of the extension (extensionColors). */
  registry?: ColorRegistry;
}

/** CIEDE2000 difference under which two colors to tell apart count as confused (a project rule, not a standard). */
export const MIN_DELTA_E_2000 = 7;
/** CIE76 difference between the status bar button of 365 Day & Night and the status bar text. */
const MIN_BUTTON_DELTA_E = 15;
/** The default of terminal.integrated.minimumContrastRatio in VS Code. */
export const TERMINAL_MINIMUM_CONTRAST = 4.5;

/** Relative luminance of xterm.js (rgb.relativeLuminance2), from 8-bit channels. */
function xtermLuminance(r: number, g: number, b: number): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return channel(r) * 0.2126 + channel(g) * 0.7152 + channel(b) * 0.0722;
}

function xtermContrast(l1: number, l2: number): number {
  return l1 < l2 ? (l2 + 0.05) / (l1 + 0.05) : (l1 + 0.05) / (l2 + 0.05);
}

type Channels = [number, number, number];

/** reduceLuminance and increaseLuminance of xterm.js: 10% darker or lighter at each step, until the ratio is met. */
function xtermStep(back: Channels, fore: Channels, ratio: number, lighter: boolean): Channels {
  const backL = xtermLuminance(...back);
  let [r, g, b] = fore;
  let ratioNow = xtermContrast(xtermLuminance(r, g, b), backL);
  while (ratioNow < ratio && (lighter ? r < 0xFF || g < 0xFF || b < 0xFF : r > 0 || g > 0 || b > 0)) {
    if (lighter) {
      r = Math.min(0xFF, r + Math.ceil((255 - r) * 0.1));
      g = Math.min(0xFF, g + Math.ceil((255 - g) * 0.1));
      b = Math.min(0xFF, b + Math.ceil((255 - b) * 0.1));
    } else {
      r -= Math.max(0, Math.ceil(r * 0.1));
      g -= Math.max(0, Math.ceil(g * 0.1));
      b -= Math.max(0, Math.ceil(b * 0.1));
    }
    ratioNow = xtermContrast(xtermLuminance(r, g, b), backL);
  }
  return [r, g, b];
}

/**
 * The color that the terminal of VS Code shows for a text on its background: xterm.js changes the color of each
 * character until it reaches the minimum contrast (rgba.ensureContrastRatio): darker when the text is darker than
 * the background, lighter otherwise, and the other way when that is not enough. Both colors are opaque.
 */
export function terminalColor(foreground: string, background: string, ratio = TERMINAL_MINIMUM_CONTRAST): string {
  const channels = (color: string): Channels => {
    const hex = color.slice(1);
    const full = hex.length <= 4 ? hex.replace(/./g, '$&$&') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Channels;
  };
  const back = channels(background);
  const fore = channels(foreground);
  const backL = xtermLuminance(...back);
  const foreL = xtermLuminance(...fore);
  if (xtermContrast(backL, foreL) >= ratio) return foreground;
  const ratioOf = (c: Channels) => xtermContrast(backL, xtermLuminance(...c));
  const first = xtermStep(back, fore, ratio, foreL >= backL);
  if (ratioOf(first) >= ratio) return toHexChannels(first);
  const second = xtermStep(back, fore, ratio, foreL < backL);
  return toHexChannels(ratioOf(first) > ratioOf(second) ? first : second);
}

function toHexChannels(channels: Channels): string {
  return '#' + channels.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** A representative TextMate scope for each syntax category. */
export const TOKEN_PROBES: Readonly<Record<string, string>> = {
  'comment': 'comment', 'keyword': 'keyword', 'function': 'entity.name.function', 'string': 'string',
  'number': 'constant.numeric', 'class': 'entity.name.class', 'variable': 'variable', 'operator': 'keyword.operator',
  'punctuation': 'punctuation', 'tag': 'entity.name.tag', 'attribute': 'entity.other.attribute-name',
  'regex': 'string.regexp', 'JSON key': 'support.type.property-name.json', 'invalid': 'invalid',
};
/** The syntax categories that must stay distinct from each other, color blindness included. */
export const DISTINCT_TOKENS = ['keyword', 'function', 'string', 'number', 'class', 'comment', 'variable'] as const;
/** WCAG 2.2, criterion 1.4.1 (use of color): these styles carry a meaning that must not rely on color alone. */
const REQUIRED_STYLES = [
  ['comment in italic', 'comment', 'italic'],
  ['invalid code underlined', 'invalid', 'underline'],
  ['deprecated code struck through', 'invalid.deprecated', 'strikethrough'],
  ['link underlined', 'markup.underline.link', 'underline'],
  ['Markdown heading in bold', 'markup.heading', 'bold'],
  ['Markdown bold in bold', 'markup.bold', 'bold'],
  ['Markdown italic in italic', 'markup.italic', 'italic'],
] as const;
const ALERT_KEYS: Readonly<Record<string, string>> = {
  'error': 'editorError.foreground', 'warning': 'editorWarning.foreground', 'info': 'editorInfo.foreground',
  'added': 'editorGutter.addedBackground', 'modified': 'editorGutter.modifiedBackground',
  'deleted': 'editorGutter.deletedBackground',
};
const DISTINCT_ALERTS: readonly [string, string][] = [
  ['error', 'warning'], ['error', 'info'], ['added', 'deleted'], ['added', 'modified'], ['modified', 'deleted'],
];
/** Rule of 365 Day & Night: semantic token rules that every theme must set. */
export const SEMANTIC_ROLES = [
  'variable.readonly', 'parameter', 'function', 'method', 'class', 'enum', 'interface', 'namespace',
  'typeParameter', 'enumMember', 'property', 'variable.defaultLibrary', 'keyword', 'comment.documentation',
] as const;
/** Rule of 365 Day & Night: recent surfaces, whose defaults in VS Code ignore the theme, must be set. */
export const PRIORITY_KEYS: readonly string[] = [
  'chat.slashCommandBackground', 'chat.slashCommandForeground', 'chat.avatarBackground', 'chat.editedFileForeground',
  'chat.linesAddedForeground', 'chat.linesRemovedForeground', 'chat.checkpointSeparator',
  'testing.iconPassed', 'testing.iconFailed', 'testing.iconErrored', 'testing.iconQueued', 'testing.iconSkipped',
  'testing.iconUnset', 'testing.runAction',
  'scmGraph.foreground1', 'scmGraph.foreground2', 'scmGraph.foreground3', 'scmGraph.foreground4', 'scmGraph.foreground5',
  'scmGraph.historyItemRefColor', 'scmGraph.historyItemRemoteRefColor', 'scmGraph.historyItemBaseRefColor',
  'scmGraph.historyItemHoverAdditionsForeground', 'scmGraph.historyItemHoverDeletionsForeground',
  'mergeEditor.change.background', 'mergeEditor.change.word.background', 'mergeEditor.changeBase.background',
  'mergeEditor.changeBase.word.background', 'mergeEditor.conflictingLines.background',
  'mergeEditor.conflict.unhandledFocused.border', 'mergeEditor.conflict.handledFocused.border',
  'multiDiffEditor.headerBackground',
  ...['class', 'constructor', 'enumerator', 'enumeratorMember', 'event', 'field', 'function', 'interface', 'method',
    'variable'].map((kind) => `symbolIcon.${kind}Foreground`),
];
/** The color that 365 Day & Night contributes for its status bar button. */
const STATUS_BAR_BUTTON = '365DayNight.statusBarButton';
/**
 * Colors that a view replaces in its own code when the key has no color: the terminal takes the background of the
 * panel (xtermTerminal.ts), and the cells of a notebook show the editor background in high contrast, where these
 * keys have no default.
 */
const VIEW_FALLBACKS: Readonly<Record<string, string>> = {
  'terminal.background': 'panel.background',
  'notebook.cellEditorBackground': 'editor.background',
  'notebook.editorBackground': 'editor.background',
};

/** The colors the checks read: in strict mode, those that the theme sets; otherwise, those that VS Code shows. */
class Colors {
  readonly strict: boolean;
  private readonly theme: Theme;
  readonly workbench: WorkbenchColors;

  constructor(theme: Theme, uiTheme: UiTheme, strict: boolean, registry: ColorRegistry) {
    this.theme = theme;
    this.strict = strict;
    this.workbench = new WorkbenchColors(theme, uiTheme, registry);
  }

  /** The color of a key, or the fallback when it has none. */
  get(key: string, fallback?: string): string | undefined {
    const color = this.strict ? this.theme.colors[key] : this.workbench.get(key).color;
    return color ?? fallback;
  }

  /** The color that VS Code shows for a key, from the theme or derived from it, with the fallbacks of the views. */
  shown(key: string): string | undefined {
    const color = this.strict ? this.theme.colors[key] ?? this.workbench.get(key).color : this.workbench.get(key).color;
    if (color !== undefined) return color;
    const fallback = VIEW_FALLBACKS[key];
    return fallback === undefined ? undefined : this.shown(fallback);
  }

  /** Keys with a prefix: those that the theme sets in strict mode, otherwise also those that VS Code knows. */
  keys(prefix: string, registry: ColorRegistry): string[] {
    const keys = new Set(Object.keys(this.theme.colors).filter((key) => key.startsWith(prefix)));
    if (!this.strict) for (const key of Object.keys(registry)) if (key.startsWith(prefix)) keys.add(key);
    return [...keys].sort();
  }
}

/** The color of each syntax category. In strict mode, a category that no rule colors has none, except variables. */
export function tokenColors(theme: Theme, uiTheme: UiTheme, strict = false): Map<string, string> {
  const tokens = new TokenColors(theme, uiTheme);
  const found = new Map<string, string>();
  for (const [label, scope] of Object.entries(TOKEN_PROBES)) {
    if (!strict || tokens.colors(scope)) found.set(label, tokens.style([scope]).foreground);
  }
  const editor = theme.colors['editor.foreground'];
  if (strict && !found.has('variable') && editor !== undefined) found.set('variable', editor);
  return found;
}

/** The semantic rules of a theme with their color, the last rule of a selector winning (as in a JSON object). */
function semanticColors(theme: Theme): Map<string, string | undefined> {
  const found = new Map<string, string | undefined>();
  for (const { selector, style, file } of theme.semanticTokenColors) {
    found.delete(selector);
    if (typeof style === 'string') found.set(selector, readColor(style, file, selector, []));
    else if (typeof style === 'object' && style !== null) {
      const foreground = (style as { foreground?: unknown }).foreground;
      found.set(selector, typeof foreground === 'string' ? readColor(foreground, file, selector, []) : undefined);
    }
  }
  return found;
}

/** The checks of one theme. */
export function auditTheme(theme: Theme, uiTheme: UiTheme, options: AuditOptions = {}): ThemeAudit {
  const strict = options.strict === true;
  const registry = options.registry ?? VSCODE_COLORS;
  const tokens = tokenColors(theme, uiTheme, strict);
  return {
    checks: checks(theme, uiTheme, strict, registry, tokens),
    distinctions: distinctions(theme, uiTheme, strict, registry, tokens),
    achromatopsia: closest(distinctTokens(tokens), combinations(DISTINCT_TOKENS.filter((t) => tokens.has(t))), { '': ACHROMATOPSIA })
      .map(({ pair, deltaE2000, cie76 }) => ({ pair, deltaE2000, cie76 })),
  };
}

function checks(theme: Theme, uiTheme: UiTheme, strict: boolean, registry: ColorRegistry, tokens: Map<string, string>): Check[] {
  const hc = uiTheme === 'hc-black' || uiTheme === 'hc-light';
  const light = uiTheme === 'vs' || uiTheme === 'hc-light';
  const colors = new Colors(theme, uiTheme, strict, registry);
  const g = (key: string, fallback?: string) => colors.get(key, fallback);
  const r = (key: string) => colors.shown(key);
  const bg = g('editor.background');
  const rows: Check[] = [];
  if (bg === undefined) return [{ label: 'editor.background', value: null, minimum: 0, status: 'missing' }];

  const chk = (label: string, fg: string | undefined, back: string | undefined, minimum: number, aaOnly = false) => {
    // In high contrast, all text needs 7:1 (WCAG AAA), the text of the interface too. The only exception (aaOnly):
    // the selected text of the debug console keeps its color on the selection
    if (hc && minimum === 4.5 && !aaOnly) minimum = 7;
    if (fg === undefined || back === undefined) {
      rows.push({ label, value: null, minimum, status: 'missing' });
      return;
    }
    const opaqueBack = back.length === 7 ? back : over(back, bg);
    const opaqueFg = fg.length === 7 ? fg : over(fg, opaqueBack);
    const ratio = contrast(opaqueFg, opaqueBack);
    rows.push({ label, value: ratio, minimum, status: ratio >= minimum ? 'pass' : 'fail' });
  };
  const onBg = (color: string | undefined) => color === undefined ? undefined : over(color, bg);

  const text = hc ? 7 : 4.5;
  // The main text: 7:1 (WCAG AAA) is a rule of 365 Day & Night; otherwise WCAG AA, and 7:1 in high contrast
  const main = strict ? 7 : 4.5;
  const sel = g('editor.selectionBackground');
  const tbg = g('terminal.background', strict ? g('panel.background') : r('terminal.background'));
  const tsel = g('terminal.selectionBackground');
  const wsel = g('selection.background');
  const onTerminal = (color: string | undefined) => color !== undefined && tbg !== undefined ? over(color, tbg) : undefined;
  // The text of the terminal as VS Code shows it, with its minimum contrast; strict mode measures the theme colors
  const terminalText = (color: string | undefined) => {
    if (strict || color === undefined || tbg === undefined) return color;
    const opaqueBack = tbg.length === 7 ? tbg : over(tbg, bg);
    return terminalColor(color.length === 7 ? color : over(color, opaqueBack), opaqueBack);
  };

  // Editor
  chk('Editor: text / background', g('editor.foreground'), bg, main);
  chk('Editor: text / current line', g('editor.foreground'), g('editor.lineHighlightBackground', bg), main);
  chk('Editor: selection visible on the background', onBg(sel), bg, hc ? 3 : 1.35);
  chk('Editor: selected text', hc ? g('editor.selectionForeground') : g('editor.foreground'), sel, hc ? 7 : 4.5);
  const isel = g('editor.inactiveSelectionBackground');
  chk('Editor: inactive selection visible', onBg(isel), bg, 1.25);
  chk('Editor: text / inactive selection', g('editor.foreground'), isel, 4.5);
  const line = over(g('editor.lineHighlightBackground', bg) ?? bg, bg);
  chk('Editor: selection distinct from the current line', onBg(sel), line, 1.2);
  chk('Find: text / current match', g('editor.foreground'), g('editor.findMatchBackground'), 4.5);
  chk('Find: border of the current match', g('editor.findMatchBorder'), bg, 3);
  chk('Find: text / other matches', g('editor.foreground'), g('editor.findMatchHighlightBackground'), 4.5);
  chk('Occurrences: border', g('editor.selectionHighlightBorder') ?? g('editor.wordHighlightBorder'), bg, hc ? 3 : 2);
  chk('Line numbers', g('editorLineNumber.foreground'), bg, 4.5);
  chk('Active line number', g('editorLineNumber.activeForeground'), bg, text);
  chk('Cursor', g('editorCursor.foreground'), bg, 3);
  for (const key of ['editorError.foreground', 'editorWarning.foreground', 'editorInfo.foreground',
    'editorGutter.addedBackground', 'editorGutter.modifiedBackground', 'editorGutter.deletedBackground']) {
    chk(`Indicator ${key}`, g(key), bg, 3);
  }
  for (const i of [1, 2, 3]) chk(`Bracket pair ${String(i)}`, g(`editorBracketHighlight.foreground${String(i)}`), bg, text);
  chk('Focus indicator', g('focusBorder'), bg, 3);

  // Terminal
  chk('Terminal: text / background', terminalText(g('terminal.foreground')), tbg, main);
  chk('Terminal: selection visible', onTerminal(tsel), tbg, hc ? 3 : 1.35);
  chk('Terminal: selected text', g('terminal.selectionForeground') ?? g('terminal.foreground'), onTerminal(tsel), hc ? 7 : 4.5);
  const tisel = g('terminal.inactiveSelectionBackground');
  chk('Terminal: inactive selection visible', onTerminal(tisel), tbg, 1.25);
  for (const key of colors.keys('terminal.ansi', registry)) {
    const name = key.slice('terminal.ansi'.length);
    // Black on a dark theme and white on a light theme are meant for the opposite background
    if ((light && !hc && (name === 'White' || name === 'BrightWhite')) || (!light && name === 'Black')) continue;
    chk(`Terminal ANSI ${name}`, terminalText(g(key)), tbg, name.endsWith('Black') ? 3 : text);
  }

  // Debug console (the text keeps its color on the selection)
  chk('Debug console: selection visible', onTerminal(wsel), tbg, hc ? 2 : 1.35);
  for (const key of ['terminal.foreground', 'debugConsole.infoForeground', 'debugConsole.warningForeground',
    'debugConsole.errorForeground', 'debugConsole.sourceForeground']) {
    const name = key.split('.').at(-1) ?? key;
    chk(`Debug console: ${name}`, g(key), tbg, text);
    chk(`Debug console: ${name} selected`, g(key), onTerminal(wsel), 4.5, true);
  }

  // Interface
  const side = g('sideBar.background', bg);
  const pairs: [string, string, number][] = [
    ['sideBar.foreground', 'sideBar.background', main],
    ['list.activeSelectionForeground', 'list.activeSelectionBackground', text],
    ['list.inactiveSelectionForeground', 'list.inactiveSelectionBackground', text],
    ['list.hoverForeground', 'list.hoverBackground', text],
    ['list.highlightForeground', 'sideBar.background', 4.5],
    ['sideBarSectionHeader.foreground', 'sideBarSectionHeader.background', text],
    ['activityBar.foreground', 'activityBar.background', text],
    ['activityBar.inactiveForeground', 'activityBar.background', 4.5],
    ['activityBarBadge.foreground', 'activityBarBadge.background', 4.5],
    ['badge.foreground', 'badge.background', 4.5],
    ['statusBar.foreground', 'statusBar.background', text],
    ['statusBar.debuggingForeground', 'statusBar.debuggingBackground', 4.5],
    ['statusBarItem.remoteForeground', 'statusBarItem.remoteBackground', 4.5],
    ['statusBarItem.prominentForeground', 'statusBarItem.prominentBackground', 4.5],
    ['statusBarItem.prominentForeground', 'statusBarItem.prominentHoverBackground', 4.5],
    ['titleBar.activeForeground', 'titleBar.activeBackground', text],
    ['titleBar.inactiveForeground', 'titleBar.inactiveBackground', 4.5],
    ['tab.activeForeground', 'tab.activeBackground', text],
    ['tab.inactiveForeground', 'tab.inactiveBackground', 4.5],
    ['tab.unfocusedActiveForeground', 'tab.unfocusedActiveBackground', 4.5],
    ['panelTitle.activeForeground', 'panel.background', text],
    ['panelTitle.inactiveForeground', 'panel.background', 4.5],
    ['button.foreground', 'button.background', 4.5],
    ['button.foreground', 'button.hoverBackground', 4.5],
    ['button.secondaryForeground', 'button.secondaryBackground', 4.5],
    ['button.secondaryForeground', 'button.secondaryHoverBackground', 4.5],
    ['input.foreground', 'input.background', text],
    ['input.placeholderForeground', 'input.background', 4.5],
    ['dropdown.foreground', 'dropdown.background', text],
    ['editorWidget.foreground', 'editorWidget.background', text],
    ['editorSuggestWidget.foreground', 'editorSuggestWidget.background', text],
    ['editorSuggestWidget.selectedForeground', 'editorSuggestWidget.selectedBackground', text],
    ['editorSuggestWidget.highlightForeground', 'editorSuggestWidget.background', 4.5],
    ['editorHoverWidget.foreground', 'editorHoverWidget.background', text],
    ['notifications.foreground', 'notifications.background', text],
    ['quickInput.foreground', 'quickInput.background', text],
    ['quickInputList.focusForeground', 'quickInputList.focusBackground', text],
    ['menu.foreground', 'menu.background', text],
    ['menu.selectionForeground', 'menu.selectionBackground', text],
    ['peekViewResult.selectionForeground', 'peekViewResult.selectionBackground', text],
    ['peekViewTitleLabel.foreground', 'peekViewTitle.background', text],
    ['breadcrumb.foreground', 'breadcrumb.background', 4.5],
    ['textLink.foreground', 'editor.background', 4.5],
    ['textPreformat.foreground', 'textCodeBlock.background', 4.5],
    ['inputValidation.errorForeground', 'inputValidation.errorBackground', 4.5],
    ['descriptionForeground', 'sideBar.background', 4.5],
    ['gitDecoration.modifiedResourceForeground', 'sideBar.background', 4.5],
    ['gitDecoration.addedResourceForeground', 'sideBar.background', 4.5],
    ['gitDecoration.deletedResourceForeground', 'sideBar.background', 4.5],
    ['gitDecoration.untrackedResourceForeground', 'sideBar.background', 4.5],
    ['gitDecoration.conflictingResourceForeground', 'sideBar.background', 4.5],
    ['gitDecoration.ignoredResourceForeground', 'sideBar.background', 3],
    // A selected file keeps the color of its Git state: it must stay visible on the selection
    ['gitDecoration.modifiedResourceForeground', 'list.activeSelectionBackground', 3],
    ['gitDecoration.addedResourceForeground', 'list.activeSelectionBackground', 3],
    ['gitDecoration.deletedResourceForeground', 'list.activeSelectionBackground', 3],
    ['gitDecoration.untrackedResourceForeground', 'list.activeSelectionBackground', 3],
    ['gitDecoration.conflictingResourceForeground', 'list.activeSelectionBackground', 3],
    ['list.errorForeground', 'sideBar.background', 4.5],
    ['list.warningForeground', 'sideBar.background', 4.5],
    ['settings.headerForeground', 'editor.background', text],
    ['keybindingLabel.foreground', 'keybindingLabel.background', text],
  ];
  for (const [fgKey, bgKey, minimum] of pairs) {
    let back = g(bgKey);
    if (back !== undefined && back.length === 9) back = over(back, bgKey.startsWith('list') ? side ?? bg : bg);
    chk(`${fgKey} / ${bgKey}`, g(fgKey), back, minimum);
  }

  // Rule of 365 Day & Night: the button of its extension in the status bar, readable and distinct from the bar text
  if (strict) {
    const button = g(STATUS_BAR_BUTTON);
    chk('Status bar button / status bar', button, g('statusBar.background'), text);
    const barText = g('statusBar.foreground');
    if (button !== undefined && barText !== undefined) {
      const distance = deltaE(button, barText);
      rows.push({ label: 'Status bar button distinct from the status bar text', value: distance, minimum: MIN_BUTTON_DELTA_E, status: distance >= MIN_BUTTON_DELTA_E ? 'pass' : 'fail' });
    }
    // Recent surfaces: keys whose defaults in VS Code ignore the theme must be set
    for (const key of PRIORITY_KEYS) {
      if (theme.colors[key] === undefined) rows.push({ label: `Required key: ${key}`, value: null, minimum: 0, status: 'missing' });
    }
  }

  // Chat
  chk('Chat: slash command / its background', g('chat.slashCommandForeground'), g('chat.slashCommandBackground'), 4.5);
  chk('Chat: avatar', g('chat.avatarForeground'), g('chat.avatarBackground'), text);
  for (const key of ['chat.editedFileForeground', 'chat.linesAddedForeground', 'chat.linesRemovedForeground']) {
    chk(`Chat: ${key} / side bar`, g(key), side, 4.5);
  }
  chk('Inline chat: text', r('inlineChat.foreground'), r('inlineChat.background'), text);
  chk('Inline chat: placeholder', r('inlineChatInput.placeholderForeground'), r('inlineChatInput.background'), 4.5);
  // Testing: result icons in the explorer, run icon in the gutter
  for (const key of ['testing.iconPassed', 'testing.iconFailed', 'testing.iconErrored', 'testing.iconQueued',
    'testing.iconSkipped', 'testing.iconUnset']) {
    chk(`Testing: ${key} / side bar`, g(key), side, 3);
  }
  chk('Testing: testing.runAction / editor', g('testing.runAction'), bg, 3);
  // Notebooks: the text and the syntax stay readable on the background of the cells
  const cell = r('notebook.cellEditorBackground');
  chk('Notebook: text / cell', g('editor.foreground'), cell, main);
  for (const label of DISTINCT_TOKENS) chk(`Notebook: token ${label} / cell`, tokens.get(label), cell, text);
  chk('Notebook: border of the focused cell', r('notebook.focusedCellBorder'), r('notebook.editorBackground'), 3);
  // Merge editor and multi-diff editor
  for (const key of ['mergeEditor.change.background', 'mergeEditor.change.word.background', 'mergeEditor.changeBase.background',
    'mergeEditor.changeBase.word.background', 'mergeEditor.conflictingLines.background']) {
    chk(`Merge: text / ${key}`, g('editor.foreground'), onBg(g(key)), text);
  }
  chk('Merge: unhandled conflict', g('mergeEditor.conflict.unhandledFocused.border'), bg, 3);
  chk('Merge: handled conflict', g('mergeEditor.conflict.handledFocused.border'), bg, 3);
  chk('Multi-diff: text / header', g('foreground'), g('multiDiffEditor.headerBackground'), text);
  // Symbol icons: outline (side bar) and suggestions
  for (const key of colors.keys('symbolIcon.', registry)) {
    chk(`Symbol: ${key} / side bar`, g(key), side, 3);
    chk(`Symbol: ${key} / suggestions`, g(key), g('editorSuggestWidget.background'), 3);
  }
  // Git graph
  for (const i of [1, 2, 3, 4, 5]) chk(`Git graph: line ${String(i)}`, g(`scmGraph.foreground${String(i)}`), side, 3);
  for (const key of ['scmGraph.historyItemRefColor', 'scmGraph.historyItemRemoteRefColor', 'scmGraph.historyItemBaseRefColor']) {
    chk(`Git graph: ${key}`, g(key), side, 3);
  }
  for (const key of ['scmGraph.historyItemHoverAdditionsForeground', 'scmGraph.historyItemHoverDeletionsForeground']) {
    chk(`Git graph: ${key} / hover`, g(key), g('editorHoverWidget.background'), 4.5);
  }
  // Command center and agent sessions
  chk('Command center: text', r('commandCenter.foreground'), g('titleBar.activeBackground'), text);
  chk('Command center: text (inactive window)', r('commandCenter.inactiveForeground'), g('titleBar.inactiveBackground'), 4.5);
  chk('Agent sessions: panel text', r('agentsPanel.foreground'), r('agentsPanel.background'), text);
  chk('Agent sessions: input', r('agentsChatInput.foreground'), r('agentsChatInput.background'), text);
  chk('Agent sessions: placeholder', r('agentsChatInput.placeholderForeground'), r('agentsChatInput.background'), 4.5);
  chk('Agent sessions: badges', r('agentsBadge.foreground'), r('agentsBadge.background'), 4.5);

  // Syntax: in strict mode, a category without a color fails, since it would take the color of the text
  for (const label of Object.keys(TOKEN_PROBES)) {
    const color = tokens.get(label);
    chk(`Token: ${label}`, color, bg, text);
    if (sel !== undefined && color !== undefined) {
      chk(`Token: ${label} selected`, hc ? g('editor.selectionForeground') : color, sel, hc ? 7 : 3);
    }
  }

  // Semantic tokens, shown when the theme enables them (always checked in strict mode): the same minimums
  const semantic = semanticColors(theme);
  if (strict) {
    for (const key of SEMANTIC_ROLES) {
      if (!semantic.has(key)) rows.push({ label: `Semantic: ${key}`, value: null, minimum: text, status: 'missing' });
    }
  }
  if (strict || theme.semanticHighlighting) {
    for (const [key, color] of [...semantic].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (color === undefined) continue;
      chk(`Semantic: ${key}`, color, bg, text);
      if (sel !== undefined) chk(`Semantic: ${key} selected`, hc ? g('editor.selectionForeground') : color, sel, hc ? 7 : 3);
    }
  }

  if (hc) {
    // Defaults of VS Code in high contrast, meant for another text: a theme that does not set them shows, for
    // example, inline code in dark text on navy blue. In strict mode, these defaults count.
    const shownOr = (key: string, useDefault: boolean) => strict && !useDefault ? g(key) : r(key);
    const hcPairs: [string, boolean, string][] = [['terminal.foreground', false, 'terminalStickyScrollHover.background']];
    if (light) {
      hcPairs.push(['textPreformat.foreground', false, 'textPreformat.background'],
        ['debugView.exceptionLabelForeground', true, 'debugView.exceptionLabelBackground'],
        ['statusBarItem.warningForeground', true, 'statusBarItem.warningBackground']);
    }
    for (const [fgKey, fgDefault, bgKey] of hcPairs) chk(`${fgKey} / ${bgKey}`, shownOr(fgKey, fgDefault), shownOr(bgKey, true), text);
  }

  // WCAG 1.4.1: the styles are a rule of 365 Day & Night. For other themes they are information: the syntax shows
  // these tokens too (`//`, `#`...), and VS Code strikes through deprecated code and underlines errors itself
  rows.push(...styleChecks(theme, uiTheme, strict).map((check): Check => strict ? check : { ...check, information: true }));
  return rows;
}

/** WCAG 1.4.1: the styles of the TextMate scopes, and the semantic rule for deprecated code. */
function styleChecks(theme: Theme, uiTheme: UiTheme, strict: boolean): Check[] {
  const tokens = new TokenColors(theme, uiTheme);
  const rows: Check[] = REQUIRED_STYLES.map(([label, scope, style]) => ({
    label: `Style (WCAG 1.4.1): ${label}`, value: null, minimum: style, status: tokens.style([scope])[style] ? 'pass' : 'fail',
  }));
  // TypeScript and other languages mark deprecated code with a semantic token: the rule `*.deprecated` covers them all
  if (strict || theme.semanticHighlighting) {
    let deprecated: unknown;
    for (const rule of theme.semanticTokenColors) if (rule.selector === '*.deprecated') deprecated = rule.style;
    const style = typeof deprecated === 'object' && deprecated !== null ? deprecated as Record<string, unknown> : undefined;
    const present = style !== undefined && (style.strikethrough === true
      || (typeof style.fontStyle === 'string' && style.fontStyle.split(/\s+/).includes('strikethrough')));
    rows.push({ label: 'Style (WCAG 1.4.1): deprecated semantic token struck through', value: null, minimum: 'strikethrough', status: present ? 'pass' : 'fail' });
  }
  return rows;
}

function combinations<T>(items: readonly T[]): [T, T][] {
  return items.flatMap((a, i) => items.slice(i + 1).map((b): [T, T] => [a, b]));
}

function distinctTokens(tokens: Map<string, string>): Map<string, string | undefined> {
  return new Map(DISTINCT_TOKENS.filter((t) => tokens.has(t)).map((t) => [t, tokens.get(t)]));
}

/** For each pair, the model that brings its two colors the closest (the first one on a tie), from closest to farthest. */
function closest(colors: Map<string, string | undefined>, pairs: readonly [string, string][], models: Readonly<Record<string, Simulation | null>>) {
  const result: { pair: [string, string]; deltaE2000: number; model: string | null; cie76: number }[] = [];
  for (const [a, b] of pairs) {
    const ca = colors.get(a);
    const cb = colors.get(b);
    if (ca === undefined || cb === undefined) continue;
    let best: { model: string; simulation: Simulation | null; delta: number } | undefined;
    for (const [model, simulation] of Object.entries(models)) {
      const delta = deltaE2000(ca, cb, simulation);
      if (best === undefined || delta < best.delta) best = { model, simulation, delta };
    }
    if (best) result.push({ pair: [a, b], deltaE2000: best.delta, model: best.model || null, cie76: deltaE(ca, cb, best.simulation) });
  }
  return result.sort((x, y) => x.deltaE2000 - y.deltaE2000);
}

/** The pairs to tell apart in each vision: syntax categories, then alerts, test results and Git graph lines. */
function distinctions(theme: Theme, uiTheme: UiTheme, strict: boolean, registry: ColorRegistry, tokens: Map<string, string>): Distinction[] {
  const colors = new Colors(theme, uiTheme, strict, registry);
  const syntax = distinctTokens(tokens);
  const alerts = new Map<string, string | undefined>(Object.entries(ALERT_KEYS).map(([name, key]) => [name, colors.get(key)]));
  alerts.set('test passed', colors.get('testing.iconPassed'));
  alerts.set('test failed', colors.get('testing.iconFailed'));
  const graph = [1, 2, 3, 4, 5].map((i) => `Git graph ${String(i)}`);
  graph.forEach((name, i) => alerts.set(name, colors.get(`scmGraph.foreground${String(i + 1)}`)));
  const alertPairs: [string, string][] = [...DISTINCT_ALERTS, ['test passed', 'test failed'], ...combinations(graph)];
  const result: Distinction[] = [];
  for (const [view, models] of Object.entries(VIEWS) as [View, Readonly<Record<string, Simulation | null>>][]) {
    const found = [...closest(syntax, combinations([...syntax.keys()]), models), ...closest(alerts, alertPairs, models)];
    for (const entry of found) result.push({ view, ...entry, status: entry.deltaE2000 >= MIN_DELTA_E_2000 ? 'pass' : 'fail' });
  }
  return result;
}

/** Whether a check counts as a failure: a failed measure, or a missing color in strict mode; never information. */
export function isFailure(check: Check | Distinction, strict = false): boolean {
  if ('information' in check) return false;
  return check.status === 'fail' || (strict && check.status === 'missing');
}

// ----- Variety between the themes of an extension (rule of 365 Day & Night, strict mode)

/** The surfaces compared between the themes of a type, with their CIE76 threshold (normal, high contrast). */
const SURFACES: readonly [string, number | null, number | null][] = [
  ['editor.background', 8, 4],
  ['sideBar.background', 7, 4],
  ['statusBar.background', null, null],
  ['activityBarBadge.background', 25, 25],
];
const SYNTAX_ROLES = ['keyword', 'function', 'string', 'number', 'class', 'comment'] as const;
const MIN_SYNTAX = 18;
const MAX_PER_FAMILY = 3;
const FAMILIES = ['pink', 'red-orange', 'yellow', 'green', 'blue-green', 'cyan', 'blue', 'violet'] as const;
const NEUTRAL_CHROMA = 4;

/** One of 8 sectors of 45° of the CIELAB hue, or `neutral` under a chroma of 4, where the hue does not show. */
export function hueFamily(color: string): string {
  const [, a, b] = lab(color);
  if (Math.hypot(a, b) < NEUTRAL_CHROMA) return 'neutral';
  const hue = (((Math.atan2(b, a) * 180) / Math.PI) % 360 + 360) % 360;
  return FAMILIES[Math.floor(((hue + 22.5) % 360) / 45)] ?? 'neutral';
}

export interface PairDistance {
  themes: [string, string];
  deltaE: number;
}

export interface VarietyMeasure {
  /** A workbench color, or `syntax` for the mean of 6 syntax colors. */
  measure: string;
  /** CIE76 threshold; null for a measure given for information. */
  threshold: number | null;
  /** Every pair of themes, from the closest to the farthest. */
  pairs: PairDistance[];
  /** The mean CIEDE2000 difference, for information: the thresholds stay in CIE76. */
  meanDeltaE2000: number;
  /** The same pairs with each color blindness simulation (Machado 2009), for information. */
  colorBlindness: Record<Deficiency, PairDistance[]> | null;
}

export interface Variety {
  uiTheme: UiTheme;
  themes: string[];
  measures: VarietyMeasure[];
  /** Hue family of each theme, for the editor background and the accent; at most 3 themes per family. */
  families: Record<'editor.background' | 'activityBarBadge.background', Record<string, string>>;
  maxPerFamily: number;
  /** Themes that lack a color or a syntax role that a measure needs: the measure is then left out. */
  missing: string[];
}

export interface NamedTheme {
  /** A name for the reports, such as the path of the theme in its extension. */
  name: string;
  uiTheme: UiTheme;
  theme: Theme;
}

/**
 * Rule of 365 Day & Night: the themes of one type in an extension must look different from each other. Each pair of
 * themes is compared on the editor background, the side bar, the accent and the syntax colors (CIE76, which the
 * thresholds of the project use), and at most 3 themes may share a hue family.
 */
export function auditVariety(themes: readonly NamedTheme[]): Variety[] {
  const result: Variety[] = [];
  for (const uiTheme of ['vs', 'vs-dark', 'hc-black', 'hc-light'] as const) {
    const group = themes.filter((t) => t.uiTheme === uiTheme);
    if (group.length === 0) continue;
    const hc = uiTheme.startsWith('hc');
    const names = group.map((t) => t.name);
    const missing = new Set<string>();
    const measures: VarietyMeasure[] = [];
    const measure = (name: string, threshold: number | null, values: (string | undefined)[] | (Map<string, string> | undefined)[],
      distance: (a: never, b: never, simulation: Simulation | null, metric: typeof deltaE) => number) => {
      if (values.some((v) => v === undefined)) {
        values.forEach((v, i) => { if (v === undefined) missing.add(names[i] ?? ''); });
        return;
      }
      const pairsFor = (simulation: Simulation | null, metric: typeof deltaE) => combinations(values.map((_, i) => i))
        .map(([i, j]) => ({ i, j, d: distance(values[i] as never, values[j] as never, simulation, metric) }))
        .sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j)
        .map(({ i, j, d }): PairDistance => ({ themes: [names[i] ?? '', names[j] ?? ''], deltaE: d }));
      const pairs = pairsFor(null, deltaE);
      const mean2000 = pairsFor(null, deltaE2000).reduce((sum, p) => sum + p.deltaE, 0) / Math.max(pairs.length, 1);
      measures.push({
        measure: name, threshold, pairs, meanDeltaE2000: mean2000,
        colorBlindness: threshold === null ? null : {
          protan: pairsFor(MACHADO.protan, deltaE), deutan: pairsFor(MACHADO.deutan, deltaE), tritan: pairsFor(MACHADO.tritan, deltaE),
        },
      });
    };
    const surface = (a: string, b: string, simulation: Simulation | null, metric: typeof deltaE) => metric(a, b, simulation);
    for (const [key, normal, high] of SURFACES) measure(key, hc ? high : normal, group.map((t) => t.theme.colors[key]), surface);
    const syntax = group.map((t) => {
      const tokens = tokenColors(t.theme, t.uiTheme, true);
      return SYNTAX_ROLES.every((role) => tokens.has(role)) ? tokens : undefined;
    });
    const syntaxDelta = (a: Map<string, string>, b: Map<string, string>, simulation: Simulation | null, metric: typeof deltaE) =>
      SYNTAX_ROLES.reduce((sum, role) => sum + metric(a.get(role) ?? '', b.get(role) ?? '', simulation), 0) / SYNTAX_ROLES.length;
    measure('syntax', MIN_SYNTAX, syntax, syntaxDelta);
    const families = (key: 'editor.background' | 'activityBarBadge.background') => Object.fromEntries(group.flatMap((t) => {
      const color = t.theme.colors[key];
      return color === undefined ? [] : [[t.name, hueFamily(color)]];
    }));
    result.push({
      uiTheme, themes: names, measures, maxPerFamily: MAX_PER_FAMILY, missing: [...missing],
      families: { 'editor.background': families('editor.background'), 'activityBarBadge.background': families('activityBarBadge.background') },
    });
  }
  return result;
}

/** The failures of a variety: pairs under a threshold, and hue families with more than 3 themes. */
export function varietyFailures(variety: Variety): string[] {
  const failures: string[] = [];
  for (const { measure, threshold, pairs } of variety.measures) {
    if (threshold === null) continue;
    for (const { themes, deltaE: d } of pairs) if (d < threshold) failures.push(`${measure}: ${themes.join(' / ')} ${d.toFixed(1)} < ${String(threshold)}`);
  }
  for (const [key, families] of Object.entries(variety.families)) {
    const counts = new Map<string, string[]>();
    for (const [name, family] of Object.entries(families)) counts.set(family, [...(counts.get(family) ?? []), name]);
    for (const [family, names] of counts) if (names.length > variety.maxPerFamily) failures.push(`${key}: ${String(names.length)} themes in the ${family} family`);
  }
  for (const name of variety.missing) failures.push(`${name}: a color or a syntax role that the variety needs is missing`);
  return failures;
}
