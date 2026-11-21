// The tests of src/tests/themes.test.ts of vscode-textmate (commit 98cc6331dc) that check how a theme gives a style to
// a scope, ported to the API of src/textmate.ts. Tests of internal structures are checked through their effect.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: see THIRD-PARTY-NOTICES.md.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FontStyle, TextMateTheme, parseRules, strArrCmp, strcmp } from '../src/textmate.ts';
import type { ParsedRule, RawRule } from '../src/textmate.ts';

function fontStyleToString(fontStyle: number): string {
  if (fontStyle === FontStyle.NotSet) return 'not set';
  const names = [[FontStyle.Italic, 'italic'], [FontStyle.Bold, 'bold'], [FontStyle.Underline, 'underline'], [FontStyle.Strikethrough, 'strikethrough']] as const;
  return names.filter(([flag]) => fontStyle & flag).map(([, name]) => name).join(' ') || 'none';
}

const foregroundOf = (theme: TextMateTheme, ...path: string[]) => theme.match(path)?.foreground ?? null;

test('Theme matching gives higher priority to deeper matches', () => {
  const theme = new TextMateTheme([
    { settings: { foreground: '#100000', background: '#200000' } },
    { scope: 'punctuation.definition.string.begin.html', settings: { foreground: '#300000' } },
    { scope: 'meta.tag punctuation.definition.string', settings: { foreground: '#400000' } },
  ]);
  assert.equal(foregroundOf(theme, 'punctuation.definition.string.begin.html'), '#300000');
});

test('Theme matching gives higher priority to parent matches 1', () => {
  const theme = new TextMateTheme([
    { settings: { foreground: '#100000', background: '#200000' } },
    { scope: 'c a', settings: { foreground: '#300000' } },
    { scope: 'd a.b', settings: { foreground: '#400000' } },
    { scope: 'a', settings: { foreground: '#500000' } },
  ]);
  assert.equal(foregroundOf(theme, 'd', 'a.b'), '#400000');
});

test('Theme matching gives higher priority to parent matches 2', () => {
  const theme = new TextMateTheme([
    { settings: { foreground: '#100000', background: '#200000' } },
    { scope: 'meta.tag entity', settings: { foreground: '#300000' } },
    { scope: 'meta.selector.css entity.name.tag', settings: { foreground: '#400000' } },
    { scope: 'entity', settings: { foreground: '#500000' } },
  ]);
  assert.equal(foregroundOf(theme, 'text.html.cshtml', 'meta.tag.structure.any.html', 'entity.name.tag.structure.any.html'), '#300000');
});

describe('Theme matching can match', () => {
  const theme = new TextMateTheme([
    { settings: { foreground: '#F8F8F2', background: '#272822' } },
    { scope: 'source, something', settings: { background: '#100000' } },
    { scope: ['bar', 'baz'], settings: { background: '#200000' } },
    { scope: 'source.css selector bar', settings: { fontStyle: 'bold' } },
    { scope: 'constant', settings: { fontStyle: 'italic', foreground: '#300000' } },
    { scope: 'constant.numeric', settings: { foreground: '#400000' } },
    { scope: 'constant.numeric.hex', settings: { fontStyle: 'bold' } },
    { scope: 'constant.numeric.oct', settings: { fontStyle: 'bold italic underline' } },
    { scope: 'constant.numeric.dec', settings: { fontStyle: '', foreground: '#500000' } },
    { scope: 'storage.object.bar', settings: { fontStyle: '', foreground: '#600000' } },
  ]);

  function match(...path: string[]) {
    const result = theme.match(path);
    if (!result) return null;
    const style: Record<string, string> = { fontStyle: fontStyleToString(result.fontStyle) };
    if (result.foreground !== null) style.foreground = result.foreground;
    if (result.background !== null) style.background = result.background;
    return style;
  }

  const cases: [string[], Record<string, string>][] = [
    [['source'], { background: '#100000', fontStyle: 'not set' }],
    [['source.ts'], { background: '#100000', fontStyle: 'not set' }],
    [['source.tss'], { background: '#100000', fontStyle: 'not set' }],
    [['something'], { background: '#100000', fontStyle: 'not set' }],
    [['something.ts'], { background: '#100000', fontStyle: 'not set' }],
    [['something.tss'], { background: '#100000', fontStyle: 'not set' }],
    [['baz'], { background: '#200000', fontStyle: 'not set' }],
    [['baz.ts'], { background: '#200000', fontStyle: 'not set' }],
    [['baz.tss'], { background: '#200000', fontStyle: 'not set' }],
    [['constant'], { foreground: '#300000', fontStyle: 'italic' }],
    [['constant.string'], { foreground: '#300000', fontStyle: 'italic' }],
    [['constant.hex'], { foreground: '#300000', fontStyle: 'italic' }],
    [['constant.numeric'], { foreground: '#400000', fontStyle: 'italic' }],
    [['constant.numeric.baz'], { foreground: '#400000', fontStyle: 'italic' }],
    [['constant.numeric.hex'], { foreground: '#400000', fontStyle: 'bold' }],
    [['constant.numeric.hex.baz'], { foreground: '#400000', fontStyle: 'bold' }],
    [['constant.numeric.oct'], { foreground: '#400000', fontStyle: 'italic bold underline' }],
    [['constant.numeric.oct.baz'], { foreground: '#400000', fontStyle: 'italic bold underline' }],
    [['constant.numeric.dec'], { foreground: '#500000', fontStyle: 'none' }],
    [['constant.numeric.dec.baz'], { foreground: '#500000', fontStyle: 'none' }],
    [['storage.object.bar'], { foreground: '#600000', fontStyle: 'none' }],
    [['storage.object.bar.baz'], { foreground: '#600000', fontStyle: 'none' }],
    [['storage.object.bart'], { fontStyle: 'not set' }],
    [['storage.object'], { fontStyle: 'not set' }],
    [['storage'], { fontStyle: 'not set' }],
    [[''], { fontStyle: 'not set' }],
    [['bazz'], { fontStyle: 'not set' }],
    [['asdfg'], { fontStyle: 'not set' }],
    [['bar'], { background: '#200000', fontStyle: 'not set' }],
    [['source.css', 'selector', 'bar'], { background: '#200000', fontStyle: 'bold' }],
  ];
  for (const [path, expected] of cases) {
    test(path.join(' ') || '(empty)', () => { assert.deepEqual(match(...path), expected); });
  }
});

test('Theme matching Microsoft/vscode#23460', () => {
  const theme = new TextMateTheme([
    { settings: { foreground: '#aec2e0', background: '#14191f' } },
    { scope: 'meta.structure.dictionary.json string.quoted.double.json', settings: { foreground: '#FF410D' } },
    { scope: 'meta.structure.dictionary.json string.quoted.double.json', settings: { foreground: '#ffffff' } },
    { scope: 'meta.structure.dictionary.value.json string.quoted.double.json', settings: { foreground: '#FF410D' } },
  ]);
  assert.equal(foregroundOf(theme, 'source.json', 'meta.structure.dictionary.json', 'meta.structure.dictionary.value.json', 'string.quoted.double.json'), '#FF410D');
});

const rule = (scope: string, parentScopes: string[] | null, index: number, fontStyle: number, foreground: string | null, background: string | null): ParsedRule =>
  ({ scope, parentScopes, index, fontStyle, foreground, background });

test('Theme parsing can parse', () => {
  const actual = parseRules([
    { settings: { foreground: '#F8F8F2', background: '#272822' } },
    { scope: 'source, something', settings: { background: '#100000' } },
    { scope: ['bar', 'baz'], settings: { background: '#010000' } },
    { scope: 'source.css selector bar', settings: { fontStyle: 'bold' } },
    { scope: 'constant', settings: { fontStyle: 'italic', foreground: '#ff0000' } },
    { scope: 'constant.numeric', settings: { foreground: '#00ff00' } },
    { scope: 'constant.numeric.hex', settings: { fontStyle: 'bold' } },
    { scope: 'constant.numeric.oct', settings: { fontStyle: 'bold italic underline' } },
    { scope: 'constant.numeric.bin', settings: { fontStyle: 'bold strikethrough' } },
    { scope: 'constant.numeric.dec', settings: { fontStyle: '', foreground: '#0000ff' } },
    { scope: 'foo', settings: { fontStyle: '', foreground: '#CFA' } },
  ]);
  assert.deepEqual(actual, [
    rule('', null, 0, FontStyle.NotSet, '#F8F8F2', '#272822'),
    rule('source', null, 1, FontStyle.NotSet, null, '#100000'),
    rule('something', null, 1, FontStyle.NotSet, null, '#100000'),
    rule('bar', null, 2, FontStyle.NotSet, null, '#010000'),
    rule('baz', null, 2, FontStyle.NotSet, null, '#010000'),
    rule('bar', ['selector', 'source.css'], 3, FontStyle.Bold, null, null),
    rule('constant', null, 4, FontStyle.Italic, '#ff0000', null),
    rule('constant.numeric', null, 5, FontStyle.NotSet, '#00ff00', null),
    rule('constant.numeric.hex', null, 6, FontStyle.Bold, null, null),
    rule('constant.numeric.oct', null, 7, FontStyle.Bold | FontStyle.Italic | FontStyle.Underline, null, null),
    rule('constant.numeric.bin', null, 8, FontStyle.Bold | FontStyle.Strikethrough, null, null),
    rule('constant.numeric.dec', null, 9, FontStyle.None, '#0000ff', null),
    rule('foo', null, 10, FontStyle.None, '#CFA', null),
  ]);
});

test('Theme resolving strcmp works', () => {
  assert.deepEqual(['bar', 'z', 'zu', 'a', 'ab', ''].sort(strcmp), ['', 'a', 'ab', 'bar', 'z', 'zu']);
});

test('Theme resolving strArrCmp works', () => {
  const cases: [string[] | null, string[] | null, number][] = [
    [null, null, 0], [null, [], -1], [null, ['a'], -1], [[], null, 1], [['a'], null, 1], [[], [], 0], [[], ['a'], -1],
    [['a'], [], 1], [['a'], ['a'], 0], [['a', 'b'], ['a'], 1], [['a'], ['a', 'b'], -1], [['a', 'b'], ['a', 'b'], 0],
    [['a', 'b'], ['a', 'c'], -1], [['a', 'c'], ['a', 'b'], 1],
  ];
  cases.forEach(([a, b, expected], i) => { assert.equal(strArrCmp(a, b), expected, String(i + 1).padStart(3, '0')); });
});

describe('Theme resolving: defaults', () => {
  const defaults = (rules: RawRule[]) => new TextMateTheme(rules).defaults;

  test('always has defaults', () => {
    assert.deepEqual(defaults([]), { fontStyle: FontStyle.None, foreground: '#000000', background: '#FFFFFF' });
  });

  test('respects incoming defaults', () => {
    assert.deepEqual(defaults([{ settings: {} }]), { fontStyle: FontStyle.None, foreground: '#000000', background: '#FFFFFF' });
    assert.deepEqual(defaults([{ settings: { fontStyle: '' } }]), { fontStyle: FontStyle.None, foreground: '#000000', background: '#FFFFFF' });
    assert.deepEqual(defaults([{ settings: { fontStyle: 'bold' } }]), { fontStyle: FontStyle.Bold, foreground: '#000000', background: '#FFFFFF' });
    assert.deepEqual(defaults([{ settings: { foreground: '#ff0000' } }]), { fontStyle: FontStyle.None, foreground: '#FF0000', background: '#FFFFFF' });
    assert.deepEqual(defaults([{ settings: { background: '#ff0000' } }]), { fontStyle: FontStyle.None, foreground: '#000000', background: '#FF0000' });
  });

  test('can merge incoming defaults', () => {
    assert.deepEqual(defaults([{ settings: { background: '#ff0000' } }, { settings: { foreground: '#00ff00' } }, { settings: { fontStyle: 'bold' } }]),
      { fontStyle: FontStyle.Bold, foreground: '#00FF00', background: '#FF0000' });
  });
});

describe('Theme resolving: rules', () => {
  test('defaults are inherited, and a rule sets only what it sets', () => {
    const theme = new TextMateTheme([{ settings: { foreground: '#F8F8F2', background: '#272822' } }, { scope: 'var', settings: { foreground: '#ff0000' } }]);
    assert.deepEqual(theme.match(['var']), { fontStyle: FontStyle.NotSet, foreground: '#FF0000', background: null });
    assert.deepEqual(theme.resolve(['var']), { fontStyle: FontStyle.None, foreground: '#FF0000', background: '#272822' });
  });

  test('same rules get merged', () => {
    const theme = new TextMateTheme([
      { settings: { foreground: '#F8F8F2', background: '#272822' } },
      { scope: 'var', settings: { foreground: '#ff0000' } },
      { scope: 'var', settings: { fontStyle: 'bold' } },
    ]);
    assert.deepEqual(theme.match(['var']), { fontStyle: FontStyle.Bold, foreground: '#FF0000', background: null });
  });

  test('rules are inherited by deeper scopes', () => {
    const theme = new TextMateTheme([
      { settings: { foreground: '#F8F8F2', background: '#272822' } },
      { scope: 'var', settings: { fontStyle: 'bold', foreground: '#ff0000' } },
      { scope: 'var.identifier', settings: { foreground: '#00ff00' } },
      { scope: 'constant', settings: { fontStyle: 'italic', foreground: '#100000' } },
      { scope: 'constant.numeric', settings: { foreground: '#200000' } },
      { scope: 'constant.numeric.hex', settings: { fontStyle: 'bold' } },
      { scope: 'constant.numeric.oct', settings: { fontStyle: 'bold italic underline' } },
      { scope: 'constant.numeric.dec', settings: { fontStyle: '', foreground: '#300000' } },
    ]);
    assert.deepEqual(theme.match(['var.identifier']), { fontStyle: FontStyle.Bold, foreground: '#00FF00', background: null });
    assert.deepEqual(theme.match(['constant.numeric']), { fontStyle: FontStyle.Italic, foreground: '#200000', background: null });
    assert.deepEqual(theme.match(['constant.numeric.hex']), { fontStyle: FontStyle.Bold, foreground: '#200000', background: null });
    assert.deepEqual(theme.match(['constant.numeric.oct']), { fontStyle: FontStyle.Bold | FontStyle.Italic | FontStyle.Underline, foreground: '#200000', background: null });
    assert.deepEqual(theme.match(['constant.numeric.dec']), { fontStyle: FontStyle.None, foreground: '#300000', background: null });
  });

  test('rules with parent scopes', () => {
    const theme = new TextMateTheme([
      { settings: { foreground: '#F8F8F2', background: '#272822' } },
      { scope: 'var', settings: { fontStyle: 'bold', foreground: '#100000' } },
      { scope: 'var.identifier', settings: { foreground: '#200000' } },
      { scope: 'source.css var', settings: { fontStyle: 'italic', foreground: '#300000' } },
      { scope: 'source.css var', settings: { fontStyle: 'underline' } },
    ]);
    assert.deepEqual(theme.match(['source.css', 'var']), { fontStyle: FontStyle.Underline, foreground: '#300000', background: null });
    assert.deepEqual(theme.match(['source.js', 'var']), { fontStyle: FontStyle.Bold, foreground: '#100000', background: null });
    // The deeper scope wins over the parent scope
    assert.deepEqual(theme.match(['source.css', 'var.identifier']), { fontStyle: FontStyle.Bold, foreground: '#200000', background: null });
  });

  test('a rule with child combinator', () => {
    const theme = new TextMateTheme([
      { settings: { foreground: '#100000' } },
      { scope: 'b a', settings: { foreground: '#200000' } },
      { scope: 'b > a', settings: { foreground: '#300000' } },
      { scope: 'c > b > a', settings: { foreground: '#400000' } },
      { scope: 'a', settings: { foreground: '#500000' } },
    ]);
    assert.equal(foregroundOf(theme, 'b', 'a'), '#300000', 'b a');
    assert.equal(foregroundOf(theme, 'b', 'c', 'a'), '#200000', 'b c a');
    assert.equal(foregroundOf(theme, 'c', 'b', 'a'), '#400000', 'c b a');
    assert.equal(foregroundOf(theme, 'c', 'b', 'd', 'a'), '#200000', 'c b d a');
  });

  test('deeper scopes have a higher specificity (#233)', () => {
    const theme = new TextMateTheme([
      { settings: { foreground: '#100000' } },
      { scope: 'y.z a.b', settings: { foreground: '#200000' } },
      { scope: 'x y a.b', settings: { foreground: '#300000' } },
    ]);
    assert.equal(foregroundOf(theme, 'x', 'a.b'), null, 'x a.b');
    assert.equal(foregroundOf(theme, 'y', 'a.b'), null, 'y a.b');
    assert.equal(foregroundOf(theme, 'y.z', 'a'), null, 'y.z a');
    assert.equal(foregroundOf(theme, 'x', 'y', 'a.b'), '#300000', 'x y a.b');
    // "x y a.b" has more scopes, but "y.z a.b" has a deeper match
    assert.equal(foregroundOf(theme, 'x', 'y.z', 'a.b'), '#200000', 'y.z a.b');
  });

  test('issue #38: ignores rules with invalid colors', () => {
    assert.deepEqual(parseRules([
      { settings: { background: '#222222', foreground: '#cccccc' } },
      { scope: 'variable', settings: { fontStyle: '' } },
      { scope: 'variable.parameter', settings: { fontStyle: 'italic', foreground: '' } },
      { scope: 'support.other.variable', settings: { fontStyle: '' } },
      { scope: 'variable.other', settings: { foreground: '', fontStyle: 'normal' } },
      { scope: 'variable.parameter.function.coffee', settings: { foreground: '#F9D423', fontStyle: 'italic' } },
    ]), [
      rule('', null, 0, FontStyle.NotSet, '#cccccc', '#222222'),
      rule('variable', null, 1, FontStyle.None, null, null),
      rule('variable.parameter', null, 2, FontStyle.Italic, null, null),
      rule('support.other.variable', null, 3, FontStyle.None, null, null),
      rule('variable.other', null, 4, FontStyle.None, null, null),
      rule('variable.parameter.function.coffee', null, 5, FontStyle.Italic, '#F9D423', null),
    ]);
  });

  test('issue #35: trailing comma in a scope selector', () => {
    const scope = ['meta.at-rule.return.scss,', 'meta.at-rule.return.scss punctuation.definition,', 'meta.at-rule.else.scss,',
      'meta.at-rule.else.scss punctuation.definition,', 'meta.at-rule.if.scss,', 'meta.at-rule.if.scss punctuation.definition,'].join('\n');
    assert.deepEqual(parseRules([{ settings: { background: '#25292C', foreground: '#EFEFEF' } }, { scope, settings: { foreground: '#CC7832' } }]), [
      rule('', null, 0, FontStyle.NotSet, '#EFEFEF', '#25292C'),
      rule('meta.at-rule.return.scss', null, 1, FontStyle.NotSet, '#CC7832', null),
      rule('punctuation.definition', ['meta.at-rule.return.scss'], 1, FontStyle.NotSet, '#CC7832', null),
      rule('meta.at-rule.else.scss', null, 1, FontStyle.NotSet, '#CC7832', null),
      rule('punctuation.definition', ['meta.at-rule.else.scss'], 1, FontStyle.NotSet, '#CC7832', null),
      rule('meta.at-rule.if.scss', null, 1, FontStyle.NotSet, '#CC7832', null),
      rule('punctuation.definition', ['meta.at-rule.if.scss'], 1, FontStyle.NotSet, '#CC7832', null),
    ]);
  });
});
