// The rules that VS Code gives to vscode-textmate for a theme, and the style of a token through its scope path.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Theme } from '../src/theme.ts';
import { EDITOR_DEFAULTS, TokenColors, normalizeColor, textMateRules } from '../src/tokens.ts';

function theme(colors: Record<string, string>, tokenColors: Theme['tokenColors']): Theme {
  return { files: [], colors, tokenColors, semanticTokenColors: [], semanticHighlighting: false, warnings: [] };
}

describe('colors of TextMate rules, as VS Code passes them on', () => {
  test('uppercase, written in full, or nothing', () => {
    assert.equal(normalizeColor('#a1b2c3'), '#A1B2C3');
    assert.equal(normalizeColor('#abc'), '#AABBCC');
    assert.equal(normalizeColor('#abcd'), '#AABBCCDD');
    assert.equal(normalizeColor('#a1b2c3d4'), '#A1B2C3D4');
    for (const value of ['', 'red', '#ab', '#a1b2c', '#GG0000', 12, null, undefined]) assert.equal(normalizeColor(value), undefined, String(value));
  });
});

describe('the rules given to vscode-textmate', () => {
  test('the default rule comes first, from the editor colors of the theme', () => {
    const rules = textMateRules(theme({ 'editor.foreground': '#ddd', 'editor.background': '#10101080' }, []), 'dark');
    assert.deepEqual(rules[0], { settings: { foreground: '#DDDDDD', background: '#10101080' } });
  });

  test('without editor colors, the defaults of VS Code for the theme type', () => {
    for (const type of ['light', 'dark', 'hcDark', 'hcLight'] as const) {
      const rules = textMateRules(theme({}, []), type);
      assert.deepEqual(rules[0], { settings: EDITOR_DEFAULTS[type] }, type);
    }
  });

  test('in High Contrast Light, the default editor foreground is the foreground of the theme', () => {
    assert.deepEqual(textMateRules(theme({ foreground: '#101010' }, []), 'hcLight')[0]?.settings?.foreground, '#101010');
    assert.deepEqual(textMateRules(theme({ foreground: '#101010' }, []), 'hcDark')[0]?.settings?.foreground, '#FFFFFF');
  });

  test('rules without scope or settings are left out, and log colors are added after the theme', () => {
    const rules = textMateRules(theme({}, [
      { settings: { foreground: '#ff0000' } },
      { scope: 'comment' },
      { scope: 'string', settings: { foreground: '#0a0', fontStyle: 'italic', background: 'nope' } },
    ]), 'light');
    assert.deepEqual(rules.slice(1).map((rule) => rule.scope), ['string', 'token.info-token', 'token.warn-token', 'token.error-token', 'token.debug-token']);
    assert.deepEqual(rules[1]?.settings, { foreground: '#00AA00', background: undefined, fontStyle: 'italic' });
  });

  test('a theme that sets token.info-token gets no log colors', () => {
    const rules = textMateRules(theme({}, [{ scope: 'token.info-token', settings: { foreground: '#123456' } }]), 'dark');
    assert.deepEqual(rules.slice(1).map((rule) => rule.scope), ['token.info-token']);
  });
});

describe('the style of a token', () => {
  const colors = new TokenColors(theme({ 'editor.foreground': '#E0E0E0', 'editor.background': '#202020' }, [
    { scope: 'source.ts', settings: { background: '#111111' } },
    { scope: 'keyword', settings: { foreground: '#ff8800', fontStyle: 'bold' } },
    { scope: 'keyword.control', settings: { foreground: '#ffaa00' } },
    { scope: 'meta.decorator keyword', settings: { fontStyle: 'italic underline' } },
    { scope: 'comment', settings: { foreground: '#808080', fontStyle: 'italic' } },
  ]), 'vs-dark');

  test('the most specific rule wins, and the rest comes from the parent scopes', () => {
    assert.deepEqual(colors.style(['source.ts', 'meta.block.ts', 'keyword.control.flow.ts']), {
      foreground: '#FFAA00', background: '#111111', italic: false, bold: true, underline: false, strikethrough: false,
    });
  });

  test('a parent scope selects another rule', () => {
    assert.deepEqual(colors.style(['source.ts', 'meta.decorator.ts', 'keyword.operator.ts']), {
      foreground: '#FF8800', background: '#111111', italic: true, bold: false, underline: true, strikethrough: false,
    });
  });

  test('a token without any rule has the editor colors', () => {
    assert.deepEqual(colors.style(['source.python', 'variable.other.python']), {
      foreground: '#E0E0E0', background: '#202020', italic: false, bold: false, underline: false, strikethrough: false,
    });
  });
});
