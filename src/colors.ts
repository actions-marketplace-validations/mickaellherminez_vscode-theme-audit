// The workbench colors of a theme as VS Code shows them, with the defaults of VS Code for the keys the theme leaves
// out. Ported from microsoft/vscode 1.147.0: src/vs/base/common/color.ts (Color, RGBA, HSLA),
// src/vs/platform/theme/common/colorUtils.ts (resolveDefaultColor, resolveColorValue, executeTransform),
// colorThemeData.ts (getColor, defines) and colorExtensionPoint.ts (the colors of an extension).
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: see THIRD-PARTY-NOTICES.md.

import { resolve } from 'node:path';

import { INVALID_COLOR, THEME_TYPES, ThemeError, readJsonc } from './theme.ts';
import type { Theme, ThemeType, ThemeWarning, UiTheme } from './theme.ts';
import { VSCODE_COLORS } from './vscode-colors.ts';

/** A default as VS Code registers it: a color, the id of another color, a transform, or nothing (null). */
export type ColorValue = string | null | { readonly rgba: readonly [number, number, number, number] } | ColorTransform;

/** The transforms of colorUtils.ts (ColorTransformType). */
export type ColorTransform =
  | { readonly op: 'darken' | 'lighten' | 'transparent'; readonly value: ColorValue; readonly factor: number }
  | { readonly op: 'opacity'; readonly value: ColorValue; readonly opacity: number }
  | { readonly op: 'opaque'; readonly value: ColorValue; readonly background: ColorValue }
  | { readonly op: 'oneOf'; readonly values: readonly ColorValue[] }
  | { readonly op: 'lessProminent'; readonly value: ColorValue; readonly background: ColorValue; readonly factor: number; readonly transparency: number }
  | { readonly op: 'ifDefinedThenElse'; readonly if: string; readonly then: ColorValue; readonly else: ColorValue }
  | { readonly op: 'mix'; readonly color: ColorValue; readonly with: ColorValue; readonly ratio?: number };

/** One default for each theme type. */
export type ColorDefaults = Readonly<Record<ThemeType, ColorValue>>;

/** The registered colors: id -> defaults for each theme type, or one value for all of them. */
export type ColorRegistry = Readonly<Record<string, ColorValue | ColorDefaults>>;

// ----- Color, RGBA and HSLA of color.ts

function roundFloat(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Red, green and blue: integers from 0 to 255; alpha from 0 to 1, rounded to 3 decimals. */
export class RGBA {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;

  constructor(r: number, g: number, b: number, a = 1) {
    this.r = Math.min(255, Math.max(0, r)) | 0;
    this.g = Math.min(255, Math.max(0, g)) | 0;
    this.b = Math.min(255, Math.max(0, b)) | 0;
    this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
  }
}

/** Hue: integer from 0 to 360; saturation, lightness and alpha from 0 to 1, rounded to 3 decimals. */
export class HSLA {
  readonly h: number;
  readonly s: number;
  readonly l: number;
  readonly a: number;

  constructor(h: number, s: number, l: number, a: number) {
    this.h = Math.max(Math.min(360, h), 0) | 0;
    this.s = roundFloat(Math.max(Math.min(1, s), 0), 3);
    this.l = roundFloat(Math.max(Math.min(1, l), 0), 3);
    this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
  }

  static fromRGBA(rgba: RGBA): HSLA {
    const r = rgba.r / 255;
    const g = rgba.g / 255;
    const b = rgba.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (min + max) / 2;
    const chroma = max - min;
    if (chroma > 0) {
      s = Math.min(l <= 0.5 ? chroma / (2 * l) : chroma / (2 - 2 * l), 1);
      switch (max) {
        case r: h = (g - b) / chroma + (g < b ? 6 : 0); break;
        case g: h = (b - r) / chroma + 2; break;
        case b: h = (r - g) / chroma + 4; break;
      }
      h *= 60;
      h = Math.round(h);
    }
    return new HSLA(h, s, l, rgba.a);
  }

  private static hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  static toRGBA(hsla: HSLA): RGBA {
    const h = hsla.h / 360;
    const { s, l, a } = hsla;
    let r: number, g: number, b: number;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = HSLA.hue2rgb(p, q, h + 1 / 3);
      g = HSLA.hue2rgb(p, q, h);
      b = HSLA.hue2rgb(p, q, h - 1 / 3);
    }
    return new RGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a);
  }
}

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 65 && code <= 70) return code - 55; // A-F
  if (code >= 97 && code <= 102) return code - 87; // a-f
  return 0;
}

/** A color of VS Code. A color made from HSLA keeps it, as VS Code does: lighten and darken start from it. */
export class Color {
  readonly rgba: RGBA;
  private readonly cachedHsla: HSLA | undefined;

  constructor(value: RGBA | HSLA) {
    if (value instanceof RGBA) {
      this.rgba = value;
    } else {
      this.cachedHsla = value;
      this.rgba = HSLA.toRGBA(value);
    }
  }

  get hsla(): HSLA {
    return this.cachedHsla ?? HSLA.fromRGBA(this.rgba);
  }

  /** Color.Format.CSS.parseHex: '#' and 3, 4, 6 or 8 digits, otherwise nothing; a character that is not a digit counts as 0. */
  static parseHex(hex: string): Color | undefined {
    if (!hex.startsWith('#')) return undefined;
    const d = (i: number) => hexDigit(hex.charCodeAt(i));
    switch (hex.length) {
      case 7: return new Color(new RGBA(16 * d(1) + d(2), 16 * d(3) + d(4), 16 * d(5) + d(6), 1));
      case 9: return new Color(new RGBA(16 * d(1) + d(2), 16 * d(3) + d(4), 16 * d(5) + d(6), (16 * d(7) + d(8)) / 255));
      case 4: return new Color(new RGBA(17 * d(1), 17 * d(2), 17 * d(3)));
      case 5: return new Color(new RGBA(17 * d(1), 17 * d(2), 17 * d(3), 17 * d(4) / 255));
      default: return undefined;
    }
  }

  /** Color.fromHex: red for a text that is not a hexadecimal color. */
  static fromHex(hex: string): Color {
    return Color.parseHex(hex) ?? new Color(new RGBA(255, 0, 0, 1));
  }

  getRelativeLuminance(): number {
    const component = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return roundFloat(0.2126 * component(this.rgba.r) + 0.7152 * component(this.rgba.g) + 0.0722 * component(this.rgba.b), 4);
  }

  isLighterThan(another: Color): boolean {
    return this.getRelativeLuminance() > another.getRelativeLuminance();
  }

  isDarkerThan(another: Color): boolean {
    return this.getRelativeLuminance() < another.getRelativeLuminance();
  }

  lighten(factor: number): Color {
    const { h, s, l, a } = this.hsla;
    return new Color(new HSLA(h, s, l + l * factor, a));
  }

  darken(factor: number): Color {
    const { h, s, l, a } = this.hsla;
    return new Color(new HSLA(h, s, l - l * factor, a));
  }

  transparent(factor: number): Color {
    const { r, g, b, a } = this.rgba;
    return new Color(new RGBA(r, g, b, a * factor));
  }

  mix(color: Color, factor = 0.5): Color {
    const t = Math.min(Math.max(factor, 0), 1);
    const from = this.rgba;
    const to = color.rgba;
    return new Color(new RGBA(from.r + (to.r - from.r) * t, from.g + (to.g - from.g) * t, from.b + (to.b - from.b) * t, from.a + (to.a - from.a) * t));
  }

  /** The opaque color that looks the same on an opaque background. */
  makeOpaque(background: Color): Color {
    if (this.rgba.a === 1 || background.rgba.a !== 1) return this;
    const { r, g, b, a } = this.rgba;
    const back = background.rgba;
    return new Color(new RGBA(back.r - a * (back.r - r), back.g - a * (back.g - g), back.b - a * (back.b - b), 1));
  }

  static getLighterColor(of: Color, relative: Color, factor?: number): Color {
    if (of.isLighterThan(relative)) return of;
    const lum1 = of.getRelativeLuminance();
    const lum2 = relative.getRelativeLuminance();
    return of.lighten((factor || 0.5) * (lum2 - lum1) / lum2);
  }

  static getDarkerColor(of: Color, relative: Color, factor?: number): Color {
    if (of.isDarkerThan(relative)) return of;
    const lum1 = of.getRelativeLuminance();
    const lum2 = relative.getRelativeLuminance();
    return of.darken((factor || 0.5) * (lum1 - lum2) / lum1);
  }

  /** Color.toString() of VS Code, as in its CSS variables: '#rrggbb' when opaque, otherwise 'rgba(r, g, b, a)'. */
  toCss(): string {
    const { r, g, b, a } = this.rgba;
    if (a === 1) return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(+a.toFixed(2))})`;
  }

  /** Color.Format.CSS.formatHexA with compact, in uppercase: '#RRGGBB', or '#RRGGBBAA' with transparency. */
  toHex(): string {
    const { r, g, b, a } = this.rgba;
    const digits = [r, g, b, ...(a === 1 ? [] : [Math.round(a * 255)])];
    return '#' + digits.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
  }
}

// ----- Resolving a color in a theme

/**
 * Where a color comes from: `theme` when the theme sets it; `default` when VS Code gives its own color; `derived`
 * when the default of VS Code is computed from other keys (`from`); `none` when VS Code gives no color at all.
 */
export type ColorOrigin = 'theme' | 'default' | 'derived' | 'none';

export interface WorkbenchColor {
  key: string;
  /** As VS Code writes it back: '#RRGGBB', or '#RRGGBBAA' with transparency; undefined when there is no color. */
  color: string | undefined;
  origin: ColorOrigin;
  /** For a derived color: the keys that its default reads, in the order VS Code reads them. */
  from: string[];
  /** Whether VS Code knows this key. A theme can set keys that VS Code does not know: they are kept, but unused. */
  registered: boolean;
}

function isColorDefaults(value: ColorValue | ColorDefaults): value is ColorDefaults {
  return value !== null && typeof value === 'object' && 'light' in value && 'dark' in value;
}

/** The workbench colors of a theme, as VS Code shows them. */
export class WorkbenchColors {
  readonly type: ThemeType;
  readonly registry: ColorRegistry;
  private readonly colors: ReadonlyMap<string, Color>;
  private readonly cache = new Map<string, { color: Color | undefined; from: string[] }>();
  private readonly resolving: string[] = [];

  /**
   * @param registry The registered colors: those of VS Code by default. Add the colors that the extension of the
   * theme contributes with `{ ...VSCODE_COLORS, ...extensionColors(folder).colors }`.
   */
  constructor(theme: Theme, uiTheme: UiTheme | ThemeType, registry: ColorRegistry = VSCODE_COLORS) {
    this.type = Object.hasOwn(THEME_TYPES, uiTheme) ? THEME_TYPES[uiTheme as UiTheme] : uiTheme as ThemeType;
    this.registry = registry;
    this.colors = new Map(Object.entries(theme.colors).map(([key, value]) => [key, Color.fromHex(value)]));
  }

  /** Whether the theme sets a color (defines of colorThemeData.ts). */
  defines(key: string): boolean {
    return this.colors.has(key);
  }

  /** A color as VS Code shows it, and where it comes from. */
  get(key: string): WorkbenchColor {
    const registered = Object.hasOwn(this.registry, key);
    const own = this.colors.get(key);
    if (own) return { key, color: own.toHex(), origin: 'theme', from: [], registered };
    const { color, from } = this.default(key);
    const origin: ColorOrigin = !color ? 'none' : from.length > 0 ? 'derived' : 'default';
    return { key, color: color?.toHex(), origin, from: [...from], registered };
  }

  /** The Color, for computations: getColor of colorThemeData.ts, with the default. */
  color(key: string): Color | undefined {
    return this.colors.get(key) ?? this.default(key).color;
  }

  /** resolveDefaultColor of colorUtils.ts, and the keys it reads. */
  private default(key: string): { color: Color | undefined; from: string[] } {
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.resolving.includes(key)) {
      throw new Error(`The default of ${key} depends on itself: ${[...this.resolving, key].join(' -> ')}`);
    }
    this.resolving.push(key);
    const from: string[] = [];
    let color: Color | undefined;
    try {
      const defaults = Object.hasOwn(this.registry, key) ? this.registry[key] : undefined;
      if (defaults) {
        color = this.resolveValue(isColorDefaults(defaults) ? defaults[this.type] : defaults, from);
      }
    } finally {
      this.resolving.pop();
    }
    const result = { color, from };
    this.cache.set(key, result);
    return result;
  }

  /** resolveColorValue of colorUtils.ts. */
  private resolveValue(value: ColorValue | undefined, from: string[]): Color | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
      if (value.startsWith('#')) return Color.fromHex(value);
      if (!from.includes(value)) from.push(value);
      return this.color(value);
    }
    if ('rgba' in value) return new Color(new RGBA(...value.rgba));
    return this.transform(value, from);
  }

  /** executeTransform of colorUtils.ts. */
  private transform(transform: ColorTransform, from: string[]): Color | undefined {
    const value = (v: ColorValue) => this.resolveValue(v, from);
    switch (transform.op) {
      case 'darken': return value(transform.value)?.darken(transform.factor);
      case 'lighten': return value(transform.value)?.lighten(transform.factor);
      case 'transparent': return value(transform.value)?.transparent(transform.factor);
      case 'opacity': {
        const rgba = value(transform.value)?.rgba;
        return rgba ? new Color(new RGBA(rgba.r, rgba.g, rgba.b, transform.opacity)) : undefined;
      }
      case 'mix': {
        const transparent = new Color(new RGBA(0, 0, 0, 0));
        const primary = value(transform.color) ?? transparent;
        const other = value(transform.with) ?? transparent;
        return primary.mix(other, transform.ratio);
      }
      case 'opaque': {
        const background = value(transform.background);
        if (!background) return value(transform.value);
        return value(transform.value)?.makeOpaque(background);
      }
      case 'oneOf':
        for (const candidate of transform.values) {
          const color = value(candidate);
          if (color) return color;
        }
        return undefined;
      case 'ifDefinedThenElse':
        return value(this.defines(transform.if) ? transform.then : transform.else);
      case 'lessProminent': {
        const color = value(transform.value);
        if (!color) return undefined;
        const background = value(transform.background);
        if (!background) return color.transparent(transform.factor * transform.transparency);
        return color.isDarkerThan(background)
          ? Color.getLighterColor(color, background, transform.factor).transparent(transform.transparency)
          : Color.getDarkerColor(color, background, transform.factor).transparent(transform.transparency);
      }
    }
  }
}

// ----- Keys that a theme leaves out

export interface MissingKey {
  key: string;
  origin: Exclude<ColorOrigin, 'theme'>;
  /** What VS Code shows instead, if anything. */
  color: string | undefined;
  /** Always false by default: a missing key is information. True with `strict`, the rule of 365 Day & Night. */
  failure: boolean;
}

/**
 * The keys that a theme leaves out, among the given ones. For a third-party theme, a missing key is information:
 * VS Code shows its default. With `strict`, every missing key is a failure, as in the audit of 365 Day & Night where
 * every key that a check uses must be set by the theme.
 */
export function missingKeys(colors: WorkbenchColors, keys: Iterable<string>, options: { strict?: boolean } = {}): MissingKey[] {
  const missing: MissingKey[] = [];
  for (const key of new Set(keys)) {
    const { color, origin } = colors.get(key);
    if (origin !== 'theme') missing.push({ key, origin, color, failure: options.strict === true });
  }
  return missing;
}

// ----- Colors that an extension contributes

/** The first character of a color id is a letter, a digit or '_', then also '.' or '+' (colorIdPattern of VS Code). */
function isColorId(id: string): boolean {
  const word = (c: string) => /\w/.test(c);
  if (!word(id.charAt(0))) return false;
  for (let i = 1; i < id.length; i++) {
    const c = id.charAt(i);
    if (!word(c) && c !== '.' && c !== '+') return false;
  }
  return true;
}

/**
 * The colors that an extension contributes (`contributes.colors` of its package.json), read as VS Code reads them:
 * a theme of the extension, or any other theme, can set them, and VS Code shows their defaults otherwise. As in VS
 * Code, an invalid entry stops the reading: the entries before it are kept.
 */
export function extensionColors(folder: string): { colors: Record<string, ColorDefaults>; warnings: ThemeWarning[] } {
  const file = resolve(folder, 'package.json');
  const manifest = readJsonc(file);
  if (typeof manifest !== 'object' || manifest === null) throw new ThemeError(file, 'expected an object');
  const contributes = (manifest as { contributes?: unknown }).contributes;
  const contributions = typeof contributes === 'object' && contributes !== null ? (contributes as { colors?: unknown }).colors : undefined;
  const colors: Record<string, ColorDefaults> = {};
  const warnings: ThemeWarning[] = [];
  if (contributions === undefined) return { colors, warnings };
  const stop = (message: string) => {
    warnings.push({ file, message: `${message}: VS Code ignores this color and the ones after it` });
    return { colors, warnings };
  };
  if (!Array.isArray(contributions)) return stop("'contributes.colors' must be an array");
  for (const contribution of contributions as unknown[]) {
    const entry = (typeof contribution === 'object' && contribution !== null ? contribution : {}) as Record<string, unknown>;
    const id = entry.id;
    if (typeof id !== 'string' || id.length === 0) return stop("a color has no 'id'");
    if (!isColorId(id)) return stop(`"${id}": an id has only letters, digits and dots, and does not start with a dot`);
    if (typeof entry.description !== 'string') return stop(`"${id}" has no 'description'`);
    const d = (typeof entry.defaults === 'object' && entry.defaults !== null ? entry.defaults : undefined) as Record<string, unknown> | undefined;
    if (!d || typeof d.light !== 'string' || typeof d.dark !== 'string') return stop(`"${id}": 'defaults' must have 'light' and 'dark'`);
    if (d.highContrast && typeof d.highContrast !== 'string') return stop(`"${id}": 'defaults.highContrast' must be a string`);
    if (d.highContrastLight && typeof d.highContrastLight !== 'string') return stop(`"${id}": 'defaults.highContrastLight' must be a string`);
    const value = (s: string, name: string): ColorValue => {
      if (s.length > 0) {
        if (!s.startsWith('#')) return s;
        // parseHex: an invalid hexadecimal color gives no default at all, where a theme would show red
        if (Color.parseHex(s)) return s;
        warnings.push({ file, message: `"${id}": ${name} ${JSON.stringify(s)} is not a hexadecimal color: VS Code gives no default` });
        return null;
      }
      warnings.push({ file, message: `"${id}": ${name} is empty: VS Code shows ${INVALID_COLOR}` });
      return INVALID_COLOR;
    };
    colors[id] = {
      light: value(d.light, 'defaults.light'),
      dark: value(d.dark, 'defaults.dark'),
      hcDark: value((d.highContrast as string | undefined) ?? d.dark, 'defaults.highContrast'),
      hcLight: value((d.highContrastLight as string | undefined) ?? d.light, 'defaults.highContrastLight'),
    };
  }
  return { colors, warnings };
}
