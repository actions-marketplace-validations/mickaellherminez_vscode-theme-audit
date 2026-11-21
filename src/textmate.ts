// How a TextMate theme gives a style to a scope: ported from src/theme.ts of vscode-textmate
// (https://github.com/microsoft/vscode-textmate, commit 98cc6331dc), the library that colors code in VS Code.
// Font family, size and line height are left out: the audit does not use them. Colors are kept as uppercase
// strings instead of ids in a color map, which gives the same comparisons.
//
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: see THIRD-PARTY-NOTICES.md.

export const FontStyle = { NotSet: -1, None: 0, Italic: 1, Bold: 2, Underline: 4, Strikethrough: 8 } as const;

/** A rule as written in a theme: `scope` is a string with commas, an array, or nothing for the defaults. */
export interface RawRule {
  scope?: unknown;
  settings?: { fontStyle?: unknown; foreground?: unknown; background?: unknown };
}

export interface ParsedRule {
  scope: string;
  /** From the deepest parent to the outermost, as in vscode-textmate. */
  parentScopes: string[] | null;
  index: number;
  fontStyle: number;
  foreground: string | null;
  background: string | null;
}

/** The style of a scope: `fontStyle` -1 and null colors mean "not set", so the parent scope's style stays. */
export interface StyleAttributes {
  fontStyle: number;
  foreground: string | null;
  background: string | null;
}

const VALID_HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function strcmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function strArrCmp(a: readonly string[] | null, b: readonly string[] | null): number {
  if (a === null && b === null) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      const res = strcmp(a[i] ?? '', b[i] ?? '');
      if (res !== 0) return res;
    }
    return 0;
  }
  return a.length - b.length;
}

/** Parses the rules of a theme (parseTheme of vscode-textmate). */
export function parseRules(rules: readonly RawRule[]): ParsedRule[] {
  const result: ParsedRule[] = [];
  rules.forEach((entry, index) => {
    if (!entry.settings) return;
    let scopes: unknown[];
    if (typeof entry.scope === 'string') {
      scopes = entry.scope.replace(/^[,]+/, '').replace(/[,]+$/, '').split(',');
    } else if (Array.isArray(entry.scope)) {
      scopes = entry.scope as unknown[];
    } else {
      scopes = [''];
    }

    let fontStyle: number = FontStyle.NotSet;
    if (typeof entry.settings.fontStyle === 'string') {
      fontStyle = FontStyle.None;
      for (const segment of entry.settings.fontStyle.split(' ')) {
        if (segment === 'italic') fontStyle |= FontStyle.Italic;
        else if (segment === 'bold') fontStyle |= FontStyle.Bold;
        else if (segment === 'underline') fontStyle |= FontStyle.Underline;
        else if (segment === 'strikethrough') fontStyle |= FontStyle.Strikethrough;
      }
    }
    const color = (value: unknown) => (typeof value === 'string' && VALID_HEX.test(value) ? value : null);
    const foreground = color(entry.settings.foreground);
    const background = color(entry.settings.background);

    for (const item of scopes) {
      const segments = String(item).trim().split(' ');
      const scope = segments[segments.length - 1] ?? '';
      const parentScopes = segments.length > 1 ? segments.slice(0, -1).reverse() : null;
      result.push({ scope, parentScopes, index, fontStyle, foreground, background });
    }
  });
  return result;
}

class TrieRule {
  scopeDepth: number;
  readonly parentScopes: readonly string[];
  fontStyle: number;
  foreground: string | null;
  background: string | null;

  constructor(scopeDepth: number, parentScopes: readonly string[] | null, fontStyle: number, foreground: string | null, background: string | null) {
    this.scopeDepth = scopeDepth;
    this.parentScopes = parentScopes ?? [];
    this.fontStyle = fontStyle;
    this.foreground = foreground;
    this.background = background;
  }

  clone(): TrieRule {
    return new TrieRule(this.scopeDepth, this.parentScopes, this.fontStyle, this.foreground, this.background);
  }

  acceptOverwrite(scopeDepth: number, fontStyle: number, foreground: string | null, background: string | null): void {
    if (this.scopeDepth <= scopeDepth) this.scopeDepth = scopeDepth;
    if (fontStyle !== FontStyle.NotSet) this.fontStyle = fontStyle;
    if (foreground !== null) this.foreground = foreground;
    if (background !== null) this.background = background;
  }
}

/** Deeper scope first, then the most specific parent scopes (TextMate's "ranking matches"). */
function bySpecificity(a: TrieRule, b: TrieRule): number {
  if (a.scopeDepth !== b.scopeDepth) return b.scopeDepth - a.scopeDepth;
  let ai = 0;
  let bi = 0;
  for (;;) {
    if (a.parentScopes[ai] === '>') ai++;
    if (b.parentScopes[bi] === '>') bi++;
    if (ai >= a.parentScopes.length || bi >= b.parentScopes.length) break;
    const diff = (b.parentScopes[bi] ?? '').length - (a.parentScopes[ai] ?? '').length;
    if (diff !== 0) return diff;
    ai++;
    bi++;
  }
  return b.parentScopes.length - a.parentScopes.length;
}

function split(scope: string): [string, string] {
  const dot = scope.indexOf('.');
  return dot === -1 ? [scope, ''] : [scope.slice(0, dot), scope.slice(dot + 1)];
}

class TrieElement {
  private readonly mainRule: TrieRule;
  private readonly rulesWithParentScopes: TrieRule[];
  private readonly children = new Map<string, TrieElement>();

  constructor(mainRule: TrieRule, rulesWithParentScopes: TrieRule[] = []) {
    this.mainRule = mainRule;
    this.rulesWithParentScopes = rulesWithParentScopes;
  }

  match(scope: string): TrieRule[] {
    if (scope !== '') {
      const [head, tail] = split(scope);
      const child = this.children.get(head);
      if (child) return child.match(tail);
    }
    return [...this.rulesWithParentScopes, this.mainRule].sort(bySpecificity);
  }

  insert(scopeDepth: number, scope: string, parentScopes: string[] | null, fontStyle: number, foreground: string | null, background: string | null): void {
    if (scope === '') {
      this.insertHere(scopeDepth, parentScopes, fontStyle, foreground, background);
      return;
    }
    const [head, tail] = split(scope);
    let child = this.children.get(head);
    if (!child) {
      child = new TrieElement(this.mainRule.clone(), this.rulesWithParentScopes.map((rule) => rule.clone()));
      this.children.set(head, child);
    }
    child.insert(scopeDepth + 1, tail, parentScopes, fontStyle, foreground, background);
  }

  private insertHere(scopeDepth: number, parentScopes: string[] | null, fontStyle: number, foreground: string | null, background: string | null): void {
    if (parentScopes === null) {
      this.mainRule.acceptOverwrite(scopeDepth, fontStyle, foreground, background);
      return;
    }
    const existing = this.rulesWithParentScopes.find((rule) => strArrCmp(rule.parentScopes, parentScopes) === 0);
    if (existing) {
      existing.acceptOverwrite(scopeDepth, fontStyle, foreground, background);
      return;
    }
    // A new rule with parent scopes inherits what it does not set from the main rule
    this.rulesWithParentScopes.push(new TrieRule(
      scopeDepth, parentScopes,
      fontStyle === FontStyle.NotSet ? this.mainRule.fontStyle : fontStyle,
      foreground ?? this.mainRule.foreground,
      background ?? this.mainRule.background,
    ));
  }
}

function matchesScope(scopeName: string, pattern: string): boolean {
  return pattern === scopeName || (scopeName.startsWith(pattern) && scopeName[pattern.length] === '.');
}

/** Whether the parents of a scope (from the deepest) match the parent scopes of a rule, '>' for a direct parent. */
function matchesParentScopes(parents: readonly string[], parentScopes: readonly string[]): boolean {
  let position = 0;
  for (let index = 0; index < parentScopes.length; index++) {
    let pattern = parentScopes[index] ?? '';
    let mustMatch = false;
    if (pattern === '>') {
      if (index === parentScopes.length - 1) return false;
      pattern = parentScopes[++index] ?? '';
      mustMatch = true;
    }
    while (position < parents.length) {
      if (matchesScope(parents[position] ?? '', pattern)) break;
      if (mustMatch) return false;
      position++;
    }
    if (position >= parents.length) return false;
    position++;
  }
  return true;
}

/** A TextMate theme, ready to give a style to a scope (Theme of vscode-textmate). */
export class TextMateTheme {
  readonly defaults: { fontStyle: number; foreground: string; background: string };
  private readonly root: TrieElement;

  constructor(rules: readonly RawRule[]) {
    const parsed = parseRules(rules).sort((a, b) => strcmp(a.scope, b.scope) || strArrCmp(a.parentScopes, b.parentScopes) || a.index - b.index);
    let fontStyle: number = FontStyle.None;
    let foreground = '#000000';
    let background = '#ffffff';
    while (parsed.length > 0 && parsed[0]?.scope === '') {
      const incoming = parsed.shift();
      if (!incoming) break;
      if (incoming.fontStyle !== FontStyle.NotSet) fontStyle = incoming.fontStyle;
      if (incoming.foreground !== null) foreground = incoming.foreground;
      if (incoming.background !== null) background = incoming.background;
    }
    this.defaults = { fontStyle, foreground: foreground.toUpperCase(), background: background.toUpperCase() };
    this.root = new TrieElement(new TrieRule(0, null, FontStyle.NotSet, null, null));
    for (const rule of parsed) {
      this.root.insert(0, rule.scope, rule.parentScopes, rule.fontStyle, rule.foreground?.toUpperCase() ?? null, rule.background?.toUpperCase() ?? null);
    }
  }

  /** Style of the last scope of a path (outermost first), or null when no rule matches its parents. */
  match(path: readonly string[]): StyleAttributes | null {
    const scopeName = path.at(-1);
    if (scopeName === undefined) return { ...this.defaults };
    const parents = path.slice(0, -1).reverse();
    const rule = this.root.match(scopeName).find((candidate) => matchesParentScopes(parents, candidate.parentScopes));
    return rule ? { fontStyle: rule.fontStyle, foreground: rule.foreground, background: rule.background } : null;
  }

  /**
   * Style of a token with this scope path (outermost first), as vscode-textmate computes it while it tokenizes:
   * from the defaults, each scope of the path sets what its style sets and keeps the rest from its parent.
   */
  resolve(path: readonly string[]): { fontStyle: number; foreground: string; background: string } {
    const result = { ...this.defaults };
    for (let i = 1; i <= path.length; i++) {
      const style = this.match(path.slice(0, i));
      if (!style) continue;
      if (style.fontStyle !== FontStyle.NotSet) result.fontStyle = style.fontStyle;
      if (style.foreground !== null) result.foreground = style.foreground;
      if (style.background !== null) result.background = style.background;
    }
    return result;
  }
}
