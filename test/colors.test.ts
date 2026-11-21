// The workbench colors of a theme as VS Code shows them. The first tests are ported from color.test.ts and
// colorUtils.test.ts of microsoft/vscode 1.147.0 (MIT License: see THIRD-PARTY-NOTICES.md). The last ones compare
// the package with the colors that VS Code itself showed for the test themes of test/data/oracle-extension.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { Color, HSLA, RGBA, WorkbenchColors, extensionColors, missingKeys } from '../src/colors.ts';
import type { ColorRegistry } from '../src/colors.ts';
import { UI_THEMES, loadTheme } from '../src/theme.ts';
import type { Theme, UiTheme } from '../src/theme.ts';
import { VSCODE_COLORS, VSCODE_SOURCE } from '../src/vscode-colors.ts';

const DATA = join(import.meta.dirname, 'data');
const ORACLE_EXTENSION = join(DATA, 'oracle-extension');

function theme(colors: Record<string, string> = {}): Theme {
  return { files: [], colors, tokenColors: [], semanticTokenColors: [], semanticHighlighting: false, warnings: [] };
}

describe('Color, ported from the tests of VS Code', () => {
  const color1 = new Color(new HSLA(60, 1, 0.5, 1));
  const color2 = new Color(new HSLA(0, 0, 0.753, 1));

  test('isLighterColor', () => {
    assert.ok(color1.isLighterThan(color2));
    // Abyss theme
    assert.ok(Color.fromHex('#770811').isLighterThan(Color.fromHex('#000c18')));
  });

  test('getLighterColor', () => {
    assert.deepStrictEqual(color1.hsla, Color.getLighterColor(color1, color2).hsla);
    assert.deepStrictEqual(new HSLA(0, 0, 0.916, 1), Color.getLighterColor(color2, color1).hsla);
    assert.deepStrictEqual(new HSLA(0, 0, 0.851, 1), Color.getLighterColor(color2, color1, 0.3).hsla);
    assert.deepStrictEqual(new HSLA(0, 0, 0.981, 1), Color.getLighterColor(color2, color1, 0.7).hsla);
    assert.deepStrictEqual(new HSLA(0, 0, 1, 1), Color.getLighterColor(color2, color1, 1).hsla);
  });

  test('isDarkerColor', () => {
    assert.ok(color2.isDarkerThan(color1));
  });

  test('getDarkerColor', () => {
    assert.deepStrictEqual(color2.hsla, Color.getDarkerColor(color2, color1).hsla);
    assert.deepStrictEqual(new HSLA(60, 1, 0.392, 1), Color.getDarkerColor(color1, color2).hsla);
    assert.deepStrictEqual(new HSLA(60, 1, 0.435, 1), Color.getDarkerColor(color1, color2, 0.3).hsla);
    assert.deepStrictEqual(new HSLA(60, 1, 0.349, 1), Color.getDarkerColor(color1, color2, 0.7).hsla);
    assert.deepStrictEqual(new HSLA(60, 1, 0.284, 1), Color.getDarkerColor(color1, color2, 1).hsla);
    // Abyss theme
    assert.deepStrictEqual(new HSLA(355, 0.874, 0.157, 1), Color.getDarkerColor(Color.fromHex('#770811'), Color.fromHex('#000c18'), 0.4).hsla);
  });

  test('luminance', () => {
    const cases: [number, number, number, number][] = [
      [0, 0, 0, 0], [255, 255, 255, 1], [255, 0, 0, 0.2126], [0, 255, 0, 0.7152], [0, 0, 255, 0.0722],
      [255, 255, 0, 0.9278], [0, 255, 255, 0.7874], [255, 0, 255, 0.2848], [192, 192, 192, 0.5271],
      [128, 128, 128, 0.2159], [128, 0, 0, 0.0459], [128, 128, 0, 0.2003], [0, 128, 0, 0.1544], [128, 0, 128, 0.0615],
      [0, 128, 128, 0.17], [0, 0, 128, 0.0156],
    ];
    for (const [r, g, b, luminance] of cases) assert.equal(new Color(new RGBA(r, g, b, 1)).getRelativeLuminance(), luminance);
  });

  const hsla: [HSLA, RGBA][] = [
    [new HSLA(0, 0, 0, 0), new RGBA(0, 0, 0, 0)], [new HSLA(0, 0, 0, 1), new RGBA(0, 0, 0, 1)],
    [new HSLA(0, 0, 1, 1), new RGBA(255, 255, 255, 1)], [new HSLA(0, 1, 0.5, 1), new RGBA(255, 0, 0, 1)],
    [new HSLA(120, 1, 0.5, 1), new RGBA(0, 255, 0, 1)], [new HSLA(240, 1, 0.5, 1), new RGBA(0, 0, 255, 1)],
    [new HSLA(60, 1, 0.5, 1), new RGBA(255, 255, 0, 1)], [new HSLA(180, 1, 0.5, 1), new RGBA(0, 255, 255, 1)],
    [new HSLA(300, 1, 0.5, 1), new RGBA(255, 0, 255, 1)], [new HSLA(0, 0, 0.753, 1), new RGBA(192, 192, 192, 1)],
    [new HSLA(0, 0, 0.502, 1), new RGBA(128, 128, 128, 1)], [new HSLA(0, 1, 0.251, 1), new RGBA(128, 0, 0, 1)],
    [new HSLA(60, 1, 0.251, 1), new RGBA(128, 128, 0, 1)], [new HSLA(120, 1, 0.251, 1), new RGBA(0, 128, 0, 1)],
    [new HSLA(300, 1, 0.251, 1), new RGBA(128, 0, 128, 1)], [new HSLA(180, 1, 0.251, 1), new RGBA(0, 128, 128, 1)],
    [new HSLA(240, 1, 0.251, 1), new RGBA(0, 0, 128, 1)],
  ];

  test('HSLA.toRGBA', () => {
    for (const [h, rgba] of hsla) assert.deepStrictEqual(HSLA.toRGBA(h), rgba);
  });

  test('HSLA.fromRGBA', () => {
    for (const [h, rgba] of hsla) assert.deepStrictEqual(HSLA.fromRGBA(rgba), h);
  });

  test('parseHex', () => {
    // invalid
    assert.equal(Color.parseHex(''), undefined);
    assert.equal(Color.parseHex('#'), undefined);
    assert.equal(Color.parseHex('#0102030'), undefined);
    // somewhat valid
    assert.deepStrictEqual(Color.parseHex('#FFFFG0')?.rgba, new RGBA(255, 255, 0, 1));
    assert.deepStrictEqual(Color.parseHex('#FFFFg0')?.rgba, new RGBA(255, 255, 0, 1));
    assert.deepStrictEqual(Color.parseHex('#-FFF00')?.rgba, new RGBA(15, 255, 0, 1));
    // valid
    const cases: [string, number, number, number][] = [
      ['#000000', 0, 0, 0], ['#FFFFFF', 255, 255, 255], ['#FF0000', 255, 0, 0], ['#00FF00', 0, 255, 0],
      ['#0000FF', 0, 0, 255], ['#FFFF00', 255, 255, 0], ['#00FFFF', 0, 255, 255], ['#FF00FF', 255, 0, 255],
      ['#C0C0C0', 192, 192, 192], ['#808080', 128, 128, 128], ['#800000', 128, 0, 0], ['#808000', 128, 128, 0],
      ['#008000', 0, 128, 0], ['#800080', 128, 0, 128], ['#008080', 0, 128, 128], ['#000080', 0, 0, 128],
      ['#010203', 1, 2, 3], ['#040506', 4, 5, 6], ['#070809', 7, 8, 9], ['#0a0A0a', 10, 10, 10], ['#0b0B0b', 11, 11, 11],
      ['#0c0C0c', 12, 12, 12], ['#0d0D0d', 13, 13, 13], ['#0e0E0e', 14, 14, 14], ['#0f0F0f', 15, 15, 15],
      ['#a0A0a0', 160, 160, 160], ['#CFA', 204, 255, 170],
    ];
    for (const [hex, r, g, b] of cases) assert.deepStrictEqual(Color.parseHex(hex)?.rgba, new RGBA(r, g, b, 1), hex);
    assert.deepStrictEqual(Color.parseHex('#CFA8')?.rgba, new RGBA(204, 255, 170, 0.533));
  });

  test('fromHex shows red for a text that is not a hexadecimal color', () => {
    for (const value of ['', 'blue', '#12', '#1234567']) assert.deepStrictEqual(Color.fromHex(value).rgba, new RGBA(255, 0, 0, 1), value);
  });

  test('written back as VS Code does: in a theme (formatHexA) and in its CSS variables (toString)', () => {
    assert.equal(Color.fromHex('#abc').toHex(), '#AABBCC');
    assert.equal(Color.fromHex('#AABBCCFF').toHex(), '#AABBCC');
    assert.equal(Color.fromHex('#AABBCC80').toHex(), '#AABBCC80');
    assert.equal(Color.fromHex('#AABBCC').toCss(), '#aabbcc');
    assert.equal(Color.fromHex('#AABBCC80').toCss(), 'rgba(170, 187, 204, 0.5)');
  });
});

describe('transforms, ported from the tests of VS Code', () => {
  const resolve = (registry: ColorRegistry, colors: Record<string, string> = {}) => new WorkbenchColors(theme(colors), 'vs-dark', registry);

  test('withOpacity replaces alpha without changing RGB', () => {
    for (const value of ['#123456', '#12345622', '#12345600']) {
      assert.deepStrictEqual(resolve({ x: { op: 'opacity', value, opacity: 0.8 } }).color('x')?.rgba, new RGBA(18, 52, 86, 0.8));
    }
  });

  test('withOpacity resolves theme colours, nested transforms and missing colours', () => {
    const colors = resolve({
      a: { op: 'opacity', value: 'source', opacity: 0.8 },
      b: { op: 'opacity', value: { op: 'lighten', value: 'source', factor: 1 }, opacity: 0.6 },
      c: { op: 'opacity', value: 'missing', opacity: 0.8 },
    }, { source: '#12345622' });
    assert.deepStrictEqual([colors.color('a')?.rgba, colors.color('b')?.rgba, colors.color('c')], [
      new RGBA(18, 52, 86, 0.8), new RGBA(36, 104, 172, 0.6), undefined,
    ]);
  });

  test('withOpacity clamps alpha to its valid range', () => {
    const rgba = [0, 1, -1, 2].map((opacity) => resolve({ x: { op: 'opacity', value: '#12345622', opacity } }).color('x')?.rgba);
    assert.deepStrictEqual(rgba, [new RGBA(18, 52, 86, 0), new RGBA(18, 52, 86, 1), new RGBA(18, 52, 86, 0), new RGBA(18, 52, 86, 1)]);
  });
});

// The expected colors come from color.ts of VS Code itself, run on the same colors
describe('the other transforms', () => {
  const colors = new WorkbenchColors(theme({ base: '#336699', glass: '#33669980', back: '#FFFFFF', set: '#000000' }), 'vs', {
    darker: { op: 'darken', value: 'base', factor: 0.5 },
    lighter: { op: 'lighten', value: 'base', factor: 0.5 },
    faded: { op: 'transparent', value: 'glass', factor: 0.5 },
    flat: { op: 'opaque', value: 'glass', background: 'back' },
    flatOnGlass: { op: 'opaque', value: 'glass', background: 'glass' },
    flatOnNothing: { op: 'opaque', value: 'glass', background: 'missing' },
    first: { op: 'oneOf', values: ['missing', null, 'base', 'back'] },
    none: { op: 'oneOf', values: ['missing'] },
    ifSet: { op: 'ifDefinedThenElse', if: 'set', then: 'base', else: 'back' },
    ifUnset: { op: 'ifDefinedThenElse', if: 'darker', then: 'base', else: 'back' },
    mixed: { op: 'mix', color: 'base', with: 'back', ratio: 0.25 },
    half: { op: 'mix', color: 'base', with: 'missing' },
    quiet: { op: 'lessProminent', value: 'base', background: 'back', factor: 0.3, transparency: 0.6 },
    quietAlone: { op: 'lessProminent', value: 'base', background: 'missing', factor: 0.5, transparency: 0.6 },
  });

  test('darken, lighten and transparent', () => {
    assert.equal(colors.get('darker').color, '#19334D');
    assert.equal(colors.get('lighter').color, '#6699CC');
    assert.equal(colors.get('faded').color, '#33669940');
  });

  test('opaque blends onto an opaque background only', () => {
    assert.equal(colors.get('flat').color, '#98B2CB');
    assert.equal(colors.get('flatOnGlass').color, '#33669980');
    assert.equal(colors.get('flatOnNothing').color, '#33669980');
  });

  test('oneOf takes the first color that exists', () => {
    assert.deepEqual([colors.get('first').color, colors.get('first').from], ['#336699', ['missing', 'base']]);
    assert.equal(colors.get('none').origin, 'none');
  });

  test('ifDefinedThenElse asks whether the theme sets a key, not whether it has a color', () => {
    assert.equal(colors.get('ifSet').color, '#336699');
    assert.equal(colors.get('ifUnset').color, '#FFFFFF');
  });

  test('mix, with transparent for a missing color', () => {
    assert.equal(colors.get('mixed').color, '#668CB2');
    assert.equal(colors.get('half').color, '#19334C80');
  });

  test('lessProminent: closer to the background, then transparent', () => {
    assert.equal(colors.get('quiet').color, '#4281C099');
    assert.equal(colors.get('quietAlone').color, '#3366994D');
  });

  test('a default that depends on itself is an error', () => {
    const loop = new WorkbenchColors(theme(), 'vs', { a: 'b', b: { op: 'transparent', value: 'a', factor: 0.5 } });
    assert.throws(() => loop.get('a'), /depends on itself: a -> b -> a/);
  });
});

describe('the color of a key and its origin', () => {
  test('set by the theme, a default of VS Code, derived from other keys, or no color', () => {
    const colors = new WorkbenchColors(theme({ 'editorWidget.background': '#202020', 'my.color': '#123' }), 'vs-dark');
    assert.deepEqual(colors.get('editorWidget.background'), { key: 'editorWidget.background', color: '#202020', origin: 'theme', from: [], registered: true });
    assert.deepEqual(colors.get('foreground'), { key: 'foreground', color: '#CCCCCC', origin: 'default', from: [], registered: true });
    assert.deepEqual(colors.get('inlineChat.background'), { key: 'inlineChat.background', color: '#202020', origin: 'derived', from: ['editorWidget.background'], registered: true });
    assert.deepEqual(colors.get('terminal.background'), { key: 'terminal.background', color: undefined, origin: 'none', from: [], registered: true });
    assert.deepEqual(colors.get('my.color'), { key: 'my.color', color: '#112233', origin: 'theme', from: [], registered: false });
    assert.equal(colors.get('not.a.color').origin, 'none');
  });

  test('each theme type has its own defaults', () => {
    const background = UI_THEMES.map((uiTheme) => new WorkbenchColors(theme(), uiTheme).get('editor.background').color);
    assert.deepEqual(background, ['#FFFFFF', '#1E1E1E', '#000000', '#FFFFFF']);
    assert.equal(new WorkbenchColors(theme({ foreground: '#101010' }), 'hc-light').get('editor.foreground').color, '#101010');
    assert.equal(new WorkbenchColors(theme({ foreground: '#101010' }), 'hc-black').get('editor.foreground').color, '#FFFFFF');
  });

  test('a color that VS Code shows in red gives red to the colors derived from it', () => {
    const colors = new WorkbenchColors(theme({ 'editorWidget.background': '#FF0000' }), 'vs');
    assert.equal(colors.get('inlineChat.background').color, '#FF0000');
  });

  test('every color of VS Code resolves for every theme type, without loops', () => {
    for (const uiTheme of UI_THEMES) {
      const colors = new WorkbenchColors(theme(), uiTheme);
      for (const key of Object.keys(VSCODE_COLORS)) assert.doesNotThrow(() => colors.get(key), key);
    }
  });

  test('the defaults come from the pinned release of VS Code', () => {
    assert.deepEqual(VSCODE_SOURCE, { version: '1.147.0', commit: '8a14f0cc1b08d531eb83255ea3764ae22aa932b5' });
    assert.ok(Object.keys(VSCODE_COLORS).length > 1000);
  });
});

describe('keys that a theme leaves out', () => {
  const colors = new WorkbenchColors(theme({ 'editor.background': '#1E1E2E' }), 'vs-dark');
  const keys = ['editor.background', 'editor.foreground', 'inlineChat.background', 'terminal.background'];

  test('information for a third-party theme', () => {
    assert.deepEqual(missingKeys(colors, keys), [
      { key: 'editor.foreground', origin: 'default', color: '#BBBBBB', failure: false },
      { key: 'inlineChat.background', origin: 'derived', color: '#252526', failure: false },
      { key: 'terminal.background', origin: 'none', color: undefined, failure: false },
    ]);
  });

  test('a failure with strict, the rule of 365 Day & Night', () => {
    assert.deepEqual(missingKeys(colors, keys, { strict: true }).map((m) => [m.key, m.failure]), [
      ['editor.foreground', true], ['inlineChat.background', true], ['terminal.background', true],
    ]);
  });
});

describe('the colors that an extension contributes', () => {
  test('read as VS Code reads them: the high contrast defaults fall back to the dark and light ones', () => {
    const { colors, warnings } = extensionColors(ORACLE_EXTENSION);
    assert.deepEqual(colors, {
      'oracle.accent': { light: 'focusBorder', dark: '#C586C0', hcDark: '#FFD700', hcLight: '#7A0099' },
      'oracle.fallback': { light: '#00800080', dark: 'editor.foreground', hcDark: 'editor.foreground', hcLight: '#00800080' },
    });
    assert.deepEqual(warnings, []);
  });

  test('an invalid hexadecimal color gives no default, an empty one gives red, an invalid entry stops the reading', () => {
    const folder = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-'));
    after(() => { rmSync(folder, { recursive: true, force: true }); });
    writeFileSync(join(folder, 'package.json'), JSON.stringify({
      contributes: {
        colors: [
          { id: 'a.color', description: 'A', defaults: { light: '#12345', dark: '', highContrast: '#000', highContrastLight: 'a.other' } },
          { id: '.dot', description: 'B', defaults: { light: '#fff', dark: '#000' } },
          { id: 'never.read', description: 'C', defaults: { light: '#fff', dark: '#000' } },
        ],
      },
    }));
    const { colors, warnings } = extensionColors(folder);
    assert.deepEqual(colors, { 'a.color': { light: null, dark: '#FF0000', hcDark: '#000', hcLight: 'a.other' } });
    assert.deepEqual(warnings.map((w) => w.message), [
      '"a.color": defaults.light "#12345" is not a hexadecimal color: VS Code gives no default',
      '"a.color": defaults.dark is empty: VS Code shows #FF0000',
      '".dot": an id has only letters, digits and dots, and does not start with a dot: VS Code ignores this color and the ones after it',
    ]);
  });

  test('an extension without colors', () => {
    assert.deepEqual(extensionColors(join(DATA, '..', '..')), { colors: {}, warnings: [] });
  });
});

describe('the colors that VS Code shows for the test themes', () => {
  const oracle = JSON.parse(readFileSync(join(DATA, 'vscode-oracle.json'), 'utf8')) as {
    vscode: { version: string; commit: string };
    themes: { label: string; path: string; uiTheme: UiTheme; applied: boolean; colors: Record<string, string | null> }[];
  };
  const registry = { ...VSCODE_COLORS, ...extensionColors(ORACLE_EXTENSION).colors };

  test('the four themes were recorded', () => {
    assert.deepEqual(oracle.themes.map((t) => [t.uiTheme, t.applied]), [['vs', true], ['vs-dark', true], ['hc-black', true], ['hc-light', true]]);
  });

  for (const entry of oracle.themes) {
    test(`${entry.label}: ${String(Object.keys(entry.colors).length)} colors as VS Code ${oracle.vscode.version} shows them`, () => {
      const colors = new WorkbenchColors(loadTheme(join(ORACLE_EXTENSION, entry.path)), entry.uiTheme, registry);
      const shown = Object.fromEntries(Object.keys(entry.colors).map((key) => [key, colors.color(key)?.toCss() ?? null]));
      assert.deepEqual(shown, entry.colors);
    });
  }
});
