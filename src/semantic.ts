// The style of a semantic token in a theme, as VS Code shows it: the rules of `semanticTokenColors`, then the
// TextMate scopes that VS Code probes for each token type. Ported from microsoft/vscode 671d82d2d8:
// tokenClassificationRegistry.ts (selectors, scores, default scopes), colorThemeData.ts (getTokenStyle,
// resolveScopes, readSemanticTokenRule), textMateScopeMatcher.ts (scope selectors), and the `semanticTokenScopes`
// of the built-in extensions `javascript` and `typescript-basics`.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: see THIRD-PARTY-NOTICES.md.

import { isSemanticStyleObject, readColor } from './theme.ts';
import type { TextMateRule, Theme, UiTheme } from './theme.ts';
import { THEME_TYPES, normalizeColor, textMateRules, workbenchColor } from './tokens.ts';
import type { TokenStyle } from './tokens.ts';

/** A token as a language server classifies it: `variable` with `readonly`, in `typescript`. */
export interface Classifier {
  type: string;
  modifiers: string[];
  language: string | undefined;
}

/** Splits `type.modifier1.modifier2:language` (parseClassifierString of VS Code). */
export function parseClassifier(text: string, defaultLanguage?: string): Classifier {
  let end = text.length;
  let language = defaultLanguage;
  const modifiers: string[] = [];
  for (let i = end - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ':' || ch === '.') {
      const segment = text.slice(i + 1, end);
      end = i;
      if (ch === ':') language = segment;
      else modifiers.push(segment);
    }
  }
  return { type: text.slice(0, end), modifiers, language };
}

/** Token types, modifiers and default TextMate scopes that VS Code knows. */
export interface SemanticRegistry {
  /** The super type of a token type: a rule for the super type also applies to it. */
  superTypes: Readonly<Record<string, string>>;
  /** For a selector, the TextMate scopes VS Code probes, in order, when no rule of the theme gives a style. */
  defaults: readonly { selector: string; language?: string; scopes: readonly (readonly string[])[] }[];
}

const scopesOf = (...scopes: string[]) => scopes.map((scope) => scope.split(' '));

/** `semanticTokenScopes` of a built-in extension of VS Code, for one language and its file extension. */
function languageDefaults(language: string, ext: string, defaultLibrary = ext) {
  const scopes: Record<string, string> = {
    'property': `variable.other.property.${ext}`,
    'property.readonly': `variable.other.constant.property.${ext}`,
    'variable': `variable.other.readwrite.${ext}`,
    'variable.readonly': `variable.other.constant.object.${ext}`,
    'function': `entity.name.function.${ext}`,
    'namespace': `entity.name.type.module.${ext}`,
    'variable.defaultLibrary': `support.variable.${defaultLibrary}`,
    'function.defaultLibrary': `support.function.${defaultLibrary}`,
  };
  return Object.entries(scopes).map(([selector, scope]) => ({ selector, language, scopes: scopesOf(scope) }));
}

/** The registry of VS Code, in the order VS Code registers it. */
export const VSCODE_REGISTRY: SemanticRegistry = {
  superTypes: { member: 'method' },
  defaults: [
    ...Object.entries({
      'comment': ['comment'], 'string': ['string'], 'keyword': ['keyword.control'], 'number': ['constant.numeric'],
      'regexp': ['constant.regexp'], 'operator': ['keyword.operator'], 'namespace': ['entity.name.namespace'],
      'type': ['entity.name.type', 'support.type'], 'struct': ['entity.name.type.struct'],
      'class': ['entity.name.type.class', 'support.class'], 'interface': ['entity.name.type.interface'],
      'enum': ['entity.name.type.enum'], 'typeParameter': ['entity.name.type.parameter'],
      'function': ['entity.name.function', 'support.function'], 'member': [],
      'method': ['entity.name.function.member', 'support.function'], 'macro': ['entity.name.function.preprocessor'],
      'variable': ['variable.other.readwrite', 'entity.name.variable'], 'parameter': ['variable.parameter'],
      'property': ['variable.other.property'], 'enumMember': ['variable.other.enummember'],
      'event': ['variable.other.event'], 'decorator': ['entity.name.decorator', 'entity.name.function'], 'label': [],
      'variable.readonly': ['variable.other.constant'], 'property.readonly': ['variable.other.constant.property'],
      'type.defaultLibrary': ['support.type'], 'class.defaultLibrary': ['support.class'],
      'interface.defaultLibrary': ['support.class'], 'variable.defaultLibrary': ['support.variable', 'support.other.variable'],
      'variable.defaultLibrary.readonly': ['support.constant'], 'property.defaultLibrary': ['support.variable.property'],
      'property.defaultLibrary.readonly': ['support.constant.property'], 'function.defaultLibrary': ['support.function'],
      'member.defaultLibrary': ['support.function'],
    }).map(([selector, scopes]) => ({ selector, scopes: scopesOf(...scopes) })),
    ...languageDefaults('javascript', 'js'),
    ...languageDefaults('javascriptreact', 'jsx', 'js'),
    ...languageDefaults('typescript', 'ts'),
    ...languageDefaults('typescriptreact', 'tsx'),
  ],
};

/** A semantic token selector and its score for a token (parseTokenSelector of VS Code). */
export class TokenSelector {
  private readonly selector: Classifier;
  private readonly superTypes: Readonly<Record<string, string>>;

  constructor(text: string, language: string | undefined, registry: SemanticRegistry = VSCODE_REGISTRY) {
    this.selector = parseClassifier(text, language);
    this.superTypes = registry.superTypes;
  }

  /** The score of the selector for a token, higher when more specific, or -1 when it does not match. */
  match(type: string, modifiers: readonly string[], language: string): number {
    const { selector } = this;
    if (!selector.type) return -1;
    let score = 0;
    if (selector.language !== undefined) {
      if (selector.language !== language) return -1;
      score += 10;
    }
    if (selector.type !== '*') {
      const hierarchy = [type];
      for (let t = this.superTypes[type]; t !== undefined && !hierarchy.includes(t); t = this.superTypes[t]) hierarchy.push(t);
      const level = hierarchy.indexOf(selector.type);
      if (level === -1) return -1;
      score += 100 - level;
    }
    if (!selector.modifiers.every((modifier) => modifiers.includes(modifier))) return -1;
    return score + selector.modifiers.length * 100;
  }
}

type Matcher = (scopes: readonly string[]) => number;

/** Score of a list of scope names on probed scopes (nameMatcher of colorThemeData.ts). */
function nameMatcher(identifiers: readonly string[], scopes: readonly string[]): number {
  if (scopes.length < identifiers.length) return -1;
  let score: number | undefined;
  const every = identifiers.every((identifier) => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const scope = scopes[i] ?? '';
      if (scope && (scope === identifier || (scope.startsWith(identifier) && scope[identifier.length] === '.'))) {
        score = (i + 1) * 0x10000 + identifier.length;
        return true;
      }
    }
    return false;
  });
  return every && score !== undefined ? score : -1;
}

/** Matchers of a scope selector: ',' or '|' for or, '-' for not, parentheses (createMatchers of VS Code). */
export function scopeMatchers(selector: string): Matcher[] {
  const tokens = selector.match(/[LR]:|[\w.:][\w.:-]*|[,|\-()]/g) ?? [];
  let position = 0;
  // Read through a function: the parsing functions move the position
  const current = (): string | undefined => tokens[position];
  const next = () => { position++; };
  const isIdentifier = (value: string | undefined): value is string => value !== undefined && /[\w.:]/.test(value);
  const results: Matcher[] = [];

  function parseOperand(): Matcher | undefined {
    if (current() === '-') {
      next();
      const negated = parseOperand();
      return negated && ((scopes) => (negated(scopes) < 0 ? 0 : -1));
    }
    if (current() === '(') {
      next();
      const inner = parseInnerExpression();
      if (current() === ')') next();
      return inner;
    }
    const identifiers: string[] = [];
    for (let token = current(); isIdentifier(token); token = current()) {
      identifiers.push(token);
      next();
    }
    if (identifiers.length > 0) {
      return (scopes) => nameMatcher(identifiers, scopes);
    }
    return undefined;
  }
  function parseConjunction(): Matcher | undefined {
    const matchers: Matcher[] = [];
    for (let matcher = parseOperand(); matcher; matcher = parseOperand()) matchers.push(matcher);
    if (matchers.length === 0) return undefined;
    return (scopes) => {
      let min = matchers[0]?.(scopes) ?? -1;
      for (let i = 1; min >= 0 && i < matchers.length; i++) min = Math.min(min, matchers[i]?.(scopes) ?? -1);
      return min;
    };
  }
  function parseInnerExpression(): Matcher | undefined {
    const matchers: Matcher[] = [];
    let matcher = parseConjunction();
    while (matcher) {
      matchers.push(matcher);
      if (current() !== '|' && current() !== ',') break;
      do next(); while (current() === '|' || current() === ',');
      matcher = parseConjunction();
    }
    if (matchers.length === 0) return undefined;
    return (scopes) => Math.max(...matchers.map((m) => m(scopes)));
  }

  for (let token = current(); token !== undefined; token = current()) {
    if (token.length === 2 && token[1] === ':') next(); // L: and R: priorities, unused here
    const matcher = parseConjunction();
    if (matcher) results.push(matcher);
    if (current() !== ',') break;
    next();
  }
  return results;
}

/** Score of a TextMate rule on probed scopes (getScopeMatcher of colorThemeData.ts). */
function ruleMatcher(rule: TextMateRule): Matcher {
  if (!rule.scope || !rule.settings) return () => -1;
  const selectors: unknown[] = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
  const matchers = selectors.flatMap((selector) => scopeMatchers(String(selector)));
  if (matchers.length === 0) return () => -1;
  return (scopes) => Math.max(...matchers.map((m) => m(scopes)));
}

/** What a semantic rule or a probed scope sets. Each property left undefined keeps the TextMate style. */
export interface SemanticStyle {
  foreground?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

type StyleKey = keyof SemanticStyle;
const FLAGS = ['bold', 'italic', 'underline', 'strikethrough'] as const;

/**
 * A style from a color and a font style (TokenStyle.fromSettings of VS Code). A font style sets the four flags,
 * each one true when its name appears in it, even inside another word.
 */
function fromSettings(foreground: string | undefined, fontStyle: unknown, flags: Partial<Record<(typeof FLAGS)[number], unknown>> = {}): SemanticStyle {
  const style: SemanticStyle = {};
  if (foreground !== undefined) style.foreground = workbenchColor(readColor(foreground, '', '', []));
  if (fontStyle !== undefined) {
    // VS Code gives it to RegExp.exec, which converts any value to a string the same way
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const found: string[] = String(fontStyle).match(/italic|bold|underline|strikethrough/g) ?? [];
    for (const flag of FLAGS) style[flag] = found.includes(flag);
  } else {
    for (const flag of FLAGS) if (flags[flag] !== undefined) style[flag] = Boolean(flags[flag]);
  }
  return style;
}

/** Semantic token styles of a theme, as VS Code shows them. */
export class SemanticTokenColors {
  /** Whether VS Code shows semantic colors with this theme (`semanticHighlighting`, the default setting). */
  readonly enabled: boolean;
  private readonly rules: { selector: TokenSelector; style: SemanticStyle }[] = [];
  private readonly defaults: { selector: TokenSelector; scopes: readonly (readonly string[])[] }[];
  private readonly textMate: { rule: TextMateRule; match: Matcher }[];
  /** The colors VS Code can give a token; a probed color outside of them is lost (getTokenColorIndex). */
  private readonly colorIndex: Set<string>;

  constructor(theme: Theme, uiTheme: UiTheme, registry: SemanticRegistry = VSCODE_REGISTRY) {
    this.enabled = theme.semanticHighlighting;
    for (const { selector, style } of theme.semanticTokenColors) {
      let parsed: SemanticStyle | undefined;
      if (typeof style === 'string') parsed = fromSettings(style, undefined);
      else if (isSemanticStyleObject(style)) {
        const foreground = typeof style.foreground === 'string' ? style.foreground : undefined;
        parsed = fromSettings(foreground, style.fontStyle, style);
      }
      if (parsed) this.rules.push({ selector: new TokenSelector(selector, undefined, registry), style: parsed });
    }
    this.defaults = registry.defaults.map(({ selector, language, scopes }) => ({ selector: new TokenSelector(selector, language, registry), scopes }));
    this.textMate = theme.tokenColors.map((rule) => ({ rule, match: ruleMatcher(rule) }));

    this.colorIndex = new Set();
    for (const { settings } of textMateRules(theme, THEME_TYPES[uiTheme])) {
      for (const color of [settings?.foreground, settings?.background]) if (typeof color === 'string') this.colorIndex.add(color);
    }
    for (const { style } of this.rules) if (style.foreground) this.colorIndex.add(style.foreground);
  }

  /**
   * The style of the first probed scope path that a TextMate rule of the theme matches, the best score winning for
   * the color and for the font style separately (resolveScopes of colorThemeData.ts).
   */
  resolveScopes(probes: readonly (readonly string[])[]): SemanticStyle | undefined {
    for (const scopes of probes) {
      let foreground: string | undefined;
      let fontStyle: string | undefined;
      let foregroundScore = -1;
      let fontStyleScore = -1;
      for (const { rule, match } of this.textMate) {
        const score = match(scopes);
        if (score < 0) continue;
        const settings = rule.settings ?? {};
        // A color that is not a string would make VS Code fail; it is skipped here
        if (score >= foregroundScore && settings.foreground && typeof settings.foreground === 'string') {
          foreground = settings.foreground;
          foregroundScore = score;
        }
        if (score >= fontStyleScore && typeof settings.fontStyle === 'string') {
          fontStyle = settings.fontStyle;
          fontStyleScore = score;
        }
      }
      if (foreground !== undefined || fontStyle !== undefined) return fromSettings(foreground, fontStyle);
    }
    return undefined;
  }

  /**
   * The style that VS Code gives a semantic token (getTokenStyle of colorThemeData.ts), or undefined when semantic
   * highlighting is off or nothing applies: the token then keeps its TextMate style.
   */
  style(type: string, modifiers: readonly string[] = [], language = ''): SemanticStyle | undefined {
    if (!this.enabled) return undefined;
    const result: SemanticStyle = {};
    const score: Record<StyleKey, number> = { foreground: -1, bold: -1, italic: -1, underline: -1, strikethrough: -1 };
    const apply = (matchScore: number, style: SemanticStyle) => {
      if (style.foreground && score.foreground <= matchScore) {
        score.foreground = matchScore;
        result.foreground = style.foreground;
      }
      for (const flag of FLAGS) {
        if (style[flag] !== undefined && score[flag] <= matchScore) {
          score[flag] = matchScore;
          result[flag] = style[flag];
        }
      }
    };
    for (const rule of this.rules) {
      const matchScore = rule.selector.match(type, modifiers, language);
      if (matchScore >= 0) apply(matchScore, rule.style);
    }
    // What the theme sets is final; the defaults only fill the rest
    for (const key of Object.keys(score) as StyleKey[]) if (score[key] !== -1) score[key] = Number.MAX_VALUE;
    for (const rule of this.defaults) {
      const matchScore = rule.selector.match(type, modifiers, language);
      if (matchScore < 0) continue;
      const style = this.resolveScopes(rule.scopes);
      if (style) apply(matchScore, style);
    }
    // A color missing from the color index of the theme gets id 0, which VS Code reads as "no color"
    const foreground = result.foreground === undefined ? undefined : normalizeColor(result.foreground);
    if (foreground === undefined || !this.colorIndex.has(foreground)) delete result.foreground;
    else result.foreground = foreground;
    return Object.keys(result).length > 0 ? result : undefined;
  }
}

/** The style of a token once VS Code applies its semantic style over its TextMate style. */
export function withSemantic(textMate: TokenStyle, semantic: SemanticStyle | undefined): TokenStyle {
  if (!semantic) return textMate;
  return {
    ...textMate,
    foreground: semantic.foreground ?? textMate.foreground,
    bold: semantic.bold ?? textMate.bold,
    italic: semantic.italic ?? textMate.italic,
    underline: semantic.underline ?? textMate.underline,
    strikethrough: semantic.strikethrough ?? textMate.strikethrough,
  };
}
