// Public API of the package. It grows with the reading engine and the checks.
export { main, packageVersion } from './main.ts';
export type { Output } from './main.ts';

export { contrast, gamma, linear, luminance, over, parse, roundHalfEven, toHex } from './color.ts';
export type { Rgb } from './color.ts';
export { ciede2000, deltaE, deltaE2000, lab } from './difference.ts';
export type { Lab } from './difference.ts';
export { ACHROMATOPSIA, BRETTEL, MACHADO, MODELS, SIMULATIONS, VIENOT, VIEWS, project, simulate } from './simulation.ts';
export type { Deficiency, HalfPlanes, Matrix, Simulation, View } from './simulation.ts';
export { INVALID_COLOR, ThemeError, UI_THEMES, extensionThemes, loadTheme, readJsonc } from './theme.ts';
export type { SemanticRule, TextMateRule, Theme, ThemeContribution, ThemeWarning, TokenSettings, UiTheme } from './theme.ts';
export { FontStyle, TextMateTheme, parseRules } from './textmate.ts';
export type { ParsedRule, RawRule, StyleAttributes } from './textmate.ts';
export { EDITOR_DEFAULTS, THEME_TYPES, TokenColors, normalizeColor, textMateRules } from './tokens.ts';
export type { ThemeType, TokenStyle } from './tokens.ts';
