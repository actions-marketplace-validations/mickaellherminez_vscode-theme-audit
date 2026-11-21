// Semantic token styles. The first tests are ported from tokenStyleResolving.test.ts of VS Code
// (microsoft/vscode 1.147.0, MIT License: see THIRD-PARTY-NOTICES.md), with the rules of the user settings
// written in the theme instead: VS Code applies both the same way.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SemanticTokenColors, TokenSelector, VSCODE_REGISTRY, parseClassifier, scopeMatchers, withSemantic } from '../src/semantic.ts';
import type { SemanticRegistry, SemanticStyle } from '../src/semantic.ts';
import type { SemanticRule, TextMateRule, Theme } from '../src/theme.ts';

interface Spec {
  colors?: Record<string, string>;
  tokenColors?: TextMateRule[];
  semanticTokenColors?: Record<string, unknown>;
  semanticHighlighting?: boolean;
}

function semantic(spec: Spec, registry?: SemanticRegistry): SemanticTokenColors {
  const rules: SemanticRule[] = Object.entries(spec.semanticTokenColors ?? {}).map(([selector, style]) => ({ selector, style, file: 'theme.json' }));
  const theme: Theme = {
    files: [], colors: spec.colors ?? {}, tokenColors: spec.tokenColors ?? [], semanticTokenColors: rules,
    semanticHighlighting: spec.semanticHighlighting ?? true, warnings: [],
  };
  return new SemanticTokenColors(theme, 'vs-dark', registry);
}

/** Expected style, as the tests of VS Code write it: a color and the bold, underline and italic flags. */
function ts(foreground: string | undefined, flags: { bold?: boolean; underline?: boolean; italic?: boolean } = {}) {
  return { foreground: foreground?.toUpperCase(), bold: flags.bold, underline: flags.underline, italic: flags.italic };
}
const undefinedStyle = {};
const unsetStyle = { bold: false, underline: false, italic: false };

function shown(style: SemanticStyle | undefined) {
  return { foreground: style?.foreground, bold: style?.bold, underline: style?.underline, italic: style?.italic };
}

function assertStyles(colors: SemanticTokenColors, expected: Record<string, ReturnType<typeof ts>>, language = 'typescript') {
  for (const [classifier, style] of Object.entries(expected)) {
    const [type = '', ...modifiers] = classifier.split('.');
    assert.deepEqual(shown(colors.style(type, modifiers, language)), style, classifier);
  }
}

describe('tests of VS Code', () => {
  test('color defaults', () => {
    const colors = semantic({
      tokenColors: [
        { scope: 'comment', settings: { foreground: '#000000' } },
        { scope: 'string', settings: { foreground: '#444444' } },
        { scope: 'constant.numeric', settings: { foreground: '#555555' } },
        { scope: 'variable', settings: { fontStyle: '', foreground: '#111111' } },
        { scope: 'keyword', settings: { foreground: '#666666' } },
        { scope: 'entity.name.type, entity.name.class, entity.name.namespace, entity.name.scope-resolution', settings: { fontStyle: 'underline', foreground: '#333333' } },
        { scope: 'entity.name.function', settings: { fontStyle: '', foreground: '#333333' } },
      ],
    });
    assertStyles(colors, {
      'comment': ts('#000000', undefinedStyle),
      'variable': ts('#111111', unsetStyle),
      'type': ts('#333333', { bold: false, underline: true, italic: false }),
      'function': ts('#333333', unsetStyle),
      'string': ts('#444444', undefinedStyle),
      'number': ts('#555555', undefinedStyle),
      'keyword': ts('#666666', undefinedStyle),
    });
  });

  test('resolveScopes', () => {
    const colors = semantic({
      tokenColors: [
        { scope: 'variable', settings: { fontStyle: '', foreground: '#F8F8F2' } },
        { scope: 'keyword.operator', settings: { fontStyle: 'italic bold underline', foreground: '#F92672' } },
        { scope: 'storage', settings: { fontStyle: 'italic', foreground: '#F92672' } },
        { scope: ['storage.type', 'meta.structure.dictionary.json string.quoted.double.json'], settings: { foreground: '#66D9EF' } },
        { scope: 'entity.name.type, entity.name.class, entity.name.namespace, entity.name.scope-resolution', settings: { fontStyle: 'underline', foreground: '#A6E22E' } },
      ],
    });
    const check = (probes: string[][], expected: ReturnType<typeof ts> | undefined, message: string) => {
      const style = colors.resolveScopes(probes);
      assert.deepEqual(style && shown(style), expected, message);
    };
    check([['variable']], ts('#F8F8F2', unsetStyle), 'variable');
    check([['keyword.operator']], ts('#F92672', { italic: true, bold: true, underline: true }), 'keyword.operator');
    check([['keyword']], undefined, 'keyword');
    check([['keyword.operators']], undefined, 'keyword.operators');
    check([['storage']], ts('#F92672', { italic: true, bold: false, underline: false }), 'storage');
    check([['storage.type']], ts('#66D9EF', { italic: true, bold: false, underline: false }), 'storage.type');
    check([['entity.name.class']], ts('#A6E22E', { italic: false, bold: false, underline: true }), 'entity.name.class');
    check([['meta.structure.dictionary.json', 'string.quoted.double.json']], ts('#66D9EF'), 'json property');
    check([['source.json', 'meta.structure.dictionary.json', 'string.quoted.double.json']], ts('#66D9EF'), 'json property in source');
    check([['keyword'], ['storage.type'], ['entity.name.class']], ts('#66D9EF', { italic: true, bold: false, underline: false }), 'first probe that matches');
  });

  test('resolveScopes - match most specific', () => {
    const colors = semantic({
      tokenColors: [
        { scope: 'entity.name.type', settings: { fontStyle: 'underline', foreground: '#A6E22E' } },
        { scope: 'entity.name.type.class', settings: { foreground: '#FF00FF' } },
        { scope: 'entity.name', settings: { foreground: '#FFFFFF' } },
      ],
    });
    assert.deepEqual(shown(colors.resolveScopes([['entity.name.type.class']])), ts('#FF00FF', { italic: false, bold: false, underline: true }));
  });

  test('rule matching', () => {
    const colors = semantic({
      colors: { 'editor.foreground': '#000000' },
      semanticTokenColors: {
        'type': '#ff0000',
        'class': { foreground: '#0000ff', italic: true },
        '*.static': { bold: true },
        '*.declaration': { italic: true },
        '*.async.static': { italic: true, underline: true },
        '*.async': { foreground: '#000fff', underline: true },
      },
    });
    assertStyles(colors, {
      'type': ts('#ff0000', undefinedStyle),
      'type.static': ts('#ff0000', { bold: true }),
      'type.static.declaration': ts('#ff0000', { bold: true, italic: true }),
      'class': ts('#0000ff', { italic: true }),
      'class.static.declaration': ts('#0000ff', { bold: true, italic: true }),
      'class.declaration': ts('#0000ff', { italic: true }),
      'class.declaration.async': ts('#000fff', { underline: true, italic: true }),
      'class.declaration.async.static': ts('#000fff', { italic: true, underline: true, bold: true }),
    });
  });

  test('super type', () => {
    const registry: SemanticRegistry = {
      ...VSCODE_REGISTRY,
      superTypes: { ...VSCODE_REGISTRY.superTypes, myTestInterface: 'interface', myTestSubInterface: 'myTestInterface' },
    };
    let colors = semantic({
      colors: { 'editor.foreground': '#000000' },
      semanticTokenColors: { 'interface': '#ff0000', 'myTestInterface': { italic: true }, 'interface.static': { bold: true } },
    }, registry);
    assertStyles(colors, { 'myTestSubInterface': ts('#ff0000', { italic: true }) });
    assertStyles(colors, { 'myTestSubInterface.static': ts('#ff0000', { italic: true, bold: true }) });

    colors = semantic({
      colors: { 'editor.foreground': '#000000' },
      semanticTokenColors: { 'interface': '#ff0000', 'myTestInterface': { foreground: '#ff00ff', italic: true } },
    }, registry);
    assertStyles(colors, { 'myTestSubInterface': ts('#ff00ff', { italic: true }) });
  });

  test('language', () => {
    const colors = semantic({
      colors: { 'editor.foreground': '#000000' },
      semanticTokenColors: {
        'interface': '#fff000',
        'interface:java': '#ff0000',
        'interface.static': { bold: true },
        'interface.static:typescript': { italic: true },
      },
    });
    assertStyles(colors, { 'interface': ts('#ff0000') }, 'java');
    assertStyles(colors, { 'interface': ts('#fff000') }, 'typescript');
    assertStyles(colors, { 'interface.static': ts('#ff0000', { bold: true }) }, 'java');
    assertStyles(colors, { 'interface.static': ts('#fff000', { bold: true, italic: true }) }, 'typescript');
  });

  test('language - scope resolving', () => {
    const registry: SemanticRegistry = {
      ...VSCODE_REGISTRY,
      defaults: [
        ...VSCODE_REGISTRY.defaults,
        { selector: 'type', language: 'typescript1', scopes: [['entity.name.type.ts1']] },
        { selector: 'type:javascript1', scopes: [['entity.name.type.js1']] },
      ],
    };
    const colors = semantic({
      colors: { 'editor.foreground': '#000000' },
      tokenColors: [
        { scope: 'entity.name.type', settings: { foreground: '#aa0000' } },
        { scope: 'entity.name.type.ts1', settings: { foreground: '#bb0000' } },
      ],
    }, registry);
    assertStyles(colors, { 'type': ts('#aa0000') }, 'javascript1');
    assertStyles(colors, { 'type': ts('#bb0000') }, 'typescript1');
  });
});

describe('selectors', () => {
  test('type, modifiers and language', () => {
    assert.deepEqual(parseClassifier('variable.readonly.static:typescript'), { type: 'variable', modifiers: ['static', 'readonly'], language: 'typescript' });
    assert.deepEqual(parseClassifier('*.async'), { type: '*', modifiers: ['async'], language: undefined });
    assert.deepEqual(parseClassifier('function', 'python'), { type: 'function', modifiers: [], language: 'python' });
  });

  test('scores: language 10, type 100 minus its level, each modifier 100', () => {
    const score = (selector: string, type: string, modifiers: string[] = [], language = 'ts') => new TokenSelector(selector, undefined).match(type, modifiers, language);
    assert.equal(score('variable', 'variable'), 100);
    assert.equal(score('variable:ts', 'variable'), 110);
    assert.equal(score('variable:py', 'variable'), -1);
    assert.equal(score('*.readonly', 'variable', ['readonly']), 100);
    assert.equal(score('variable.readonly', 'variable', ['readonly', 'static']), 200);
    assert.equal(score('variable.readonly', 'variable'), -1);
    assert.equal(score('method', 'member'), 99);
    assert.equal(score('.readonly', 'variable', ['readonly']), -1);
  });

  test('TextMate scope selectors: or, and, not, parentheses', () => {
    const score = (selector: string, scopes: string[]) => Math.max(-1, ...scopeMatchers(selector).map((m) => m(scopes)));
    assert.equal(score('string', ['string.quoted']), 0x10000 + 6);
    assert.equal(score('strin', ['string.quoted']), -1);
    assert.equal(score('source string', ['source.ts', 'string']), 2 * 0x10000 + 6);
    assert.equal(score('string - comment', ['string']), 0);
    assert.equal(score('string - string.quoted', ['string.quoted']), -1);
    assert.equal(score('(comment | string), keyword', ['keyword.control']), 0x10000 + 7);
    assert.equal(score('L:string', ['string']), 0x10000 + 6);
    assert.equal(score('', ['string']), -1);
  });
});

describe('semantic styles of a theme', () => {
  test('nothing when the theme turns semantic highlighting off', () => {
    const colors = semantic({ semanticHighlighting: false, semanticTokenColors: { variable: '#123456' } });
    assert.equal(colors.enabled, false);
    assert.equal(colors.style('variable'), undefined);
  });

  test('nothing when no rule and no probed scope applies: the TextMate style stays', () => {
    assert.equal(semantic({}).style('variable', [], 'typescript'), undefined);
    assert.equal(semantic({ semanticTokenColors: { variable: '#123456' } }).style('label'), undefined);
  });

  test('the scopes of the built-in TypeScript extension', () => {
    const colors = semantic({
      tokenColors: [
        { scope: 'variable.other.constant', settings: { foreground: '#111111' } },
        { scope: 'variable.other.constant.object.ts', settings: { foreground: '#222222' } },
      ],
    });
    assert.equal(colors.style('variable', ['readonly'], 'typescript')?.foreground, '#222222');
    assert.equal(colors.style('variable', ['readonly'], 'python')?.foreground, '#111111');
  });

  test('a rule of the theme wins over probed scopes, property by property', () => {
    const colors = semantic({
      tokenColors: [{ scope: 'variable.parameter', settings: { foreground: '#111111', fontStyle: 'italic' } }],
      semanticTokenColors: { parameter: { bold: true } },
    });
    assert.deepEqual(colors.style('parameter'), { foreground: '#111111', bold: true, italic: true, underline: false, strikethrough: false });
  });

  test('a color VS Code cannot read is red, and a font style is searched for its words', () => {
    const colors = semantic({ semanticTokenColors: { variable: 'blue', parameter: { fontStyle: 'bolditalic' } } });
    assert.equal(colors.style('variable')?.foreground, '#FF0000');
    assert.deepEqual(colors.style('parameter'), { bold: true, italic: true, underline: false, strikethrough: false });
  });

  test('a style needs a string or a boolean that VS Code recognizes; then other flags count when truthy', () => {
    const colors = semantic({ semanticTokenColors: { variable: { bold: 1 }, property: { italic: true, bold: 1 } } });
    assert.equal(colors.style('variable'), undefined);
    assert.deepEqual(colors.style('property'), { italic: true, bold: true });
  });

  test('colors with transparency are kept, written in full', () => {
    assert.equal(semantic({ semanticTokenColors: { variable: '#abc8' } }).style('variable')?.foreground, '#AABBCC88');
  });

  test('a probed color outside the color index of the theme is lost, as in VS Code', () => {
    // 'red' is not a color for the TextMate rules, so it is not in the index; VS Code reads it as #FF0000 here
    const colors = semantic({ tokenColors: [{ scope: 'variable.parameter', settings: { foreground: 'red', fontStyle: 'bold' } }] });
    assert.deepEqual(colors.style('parameter'), { bold: true, italic: false, underline: false, strikethrough: false });
  });

  test('the semantic style goes over the TextMate style', () => {
    const textMate = { foreground: '#111111', background: '#000000', bold: false, italic: true, underline: false, strikethrough: false };
    assert.equal(withSemantic(textMate, undefined), textMate);
    assert.deepEqual(withSemantic(textMate, { foreground: '#222222', italic: false }), { ...textMate, foreground: '#222222', italic: false });
  });
});
