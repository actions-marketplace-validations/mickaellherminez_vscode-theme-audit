// Reading a theme the way VS Code does: JSON with comments, include, "default", invalid colors, the old format,
// and the themes of an extension folder.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';

import { INVALID_COLOR, ThemeError, extensionThemes, loadTheme } from '../src/theme.ts';

const root = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-'));
after(() => { rmSync(root, { recursive: true, force: true }); });

let count = 0;
/** Writes files in a new folder and returns its path. */
function folder(files: Record<string, string | object>): string {
  const dir = join(root, String(count++));
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

describe('JSON with comments, as VS Code reads it', () => {
  test('comments anywhere and trailing commas are accepted', () => {
    const dir = folder({
      'theme.json': `{
        // a line comment
        "colors": { "editor.background": "#101010", /* a block comment */ "editor.foreground": "#EEEEEE", },
        "tokenColors": [ { "scope": "comment", "settings": { "foreground": "#808080" } }, ], // after a value
      }`,
    });
    const theme = loadTheme(join(dir, 'theme.json'));
    assert.deepEqual(theme.colors, { 'editor.background': '#101010', 'editor.foreground': '#EEEEEE' });
    assert.equal(theme.tokenColors.length, 1);
    assert.deepEqual(theme.warnings, []);
  });

  test('a syntax error is refused, with its line and column', () => {
    const dir = folder({ 'theme.json': '{\n  "colors": {\n    "editor.background" "#101010"\n  }\n}' });
    assert.throws(() => loadTheme(join(dir, 'theme.json')), (error: unknown) => {
      assert.ok(error instanceof ThemeError);
      assert.match(error.message, /VS Code cannot parse this JSON: ColonExpected at 3:25/);
      return true;
    });
  });

  test('a theme file must hold an object', () => {
    const dir = folder({ 'theme.json': '[]' });
    assert.throws(() => loadTheme(join(dir, 'theme.json')), /expects an object/);
  });

  test('a missing file is reported', () => {
    assert.throws(() => loadTheme(join(root, 'missing.json')), /cannot be read/);
  });
});

describe('include', () => {
  test('the included theme comes first, then the theme overrides its colors and adds its rules', () => {
    const dir = folder({
      'base.json': {
        colors: { 'editor.background': '#000000', 'editor.foreground': '#FFFFFF', 'focusBorder': '#0000FF' },
        tokenColors: [{ scope: 'comment', settings: { foreground: '#808080' } }],
        semanticTokenColors: { variable: '#AAAAAA' },
      },
      'themes/dark.json': {
        include: '../base.json',
        colors: { 'editor.foreground': '#EEEEEE', 'focusBorder': 'default' },
        tokenColors: [{ scope: 'keyword', settings: { foreground: '#FF8800' } }],
        semanticTokenColors: { parameter: '#BBBBBB' },
        semanticHighlighting: true,
      },
    });
    const theme = loadTheme(join(dir, 'themes', 'dark.json'));
    assert.deepEqual(theme.files, [join(dir, 'themes', 'dark.json'), join(dir, 'base.json')]);
    // "default" removes the color of the included theme: VS Code then uses its own default
    assert.deepEqual(theme.colors, { 'editor.background': '#000000', 'editor.foreground': '#EEEEEE' });
    assert.deepEqual(theme.tokenColors.map((rule) => rule.scope), ['comment', 'keyword']);
    assert.deepEqual(theme.semanticTokenColors.map((rule) => rule.selector), ['variable', 'parameter']);
    assert.equal(theme.semanticHighlighting, true);
  });

  test('a theme that includes itself is refused', () => {
    const dir = folder({ 'a.json': { include: './b.json' }, 'b.json': { include: './a.json' } });
    assert.throws(() => loadTheme(join(dir, 'a.json')), /includes itself/);
  });
});

describe('colors that VS Code cannot read', () => {
  test('red without "#" or with a wrong length, 0 for a character that is not a digit', () => {
    const dir = folder({
      'theme.json': {
        colors: {
          'editor.background': 'red', 'editor.foreground': '#FFFFF', 'focusBorder': '#GG0000',
          'editor.selectionBackground': '#ABC', 'editor.lineHighlightBackground': '#FFFFFF10',
          'editorCursor.foreground': 12, 'editorLink.activeForeground': null, 'symbolIcon.constantForeground': ['#AFF5B4'],
          'diffEditor.move.border': '',
        },
      },
    });
    const theme = loadTheme(join(dir, 'theme.json'));
    assert.deepEqual(theme.colors, {
      'editor.background': INVALID_COLOR, 'editor.foreground': INVALID_COLOR, 'focusBorder': '#000000',
      'editor.selectionBackground': '#ABC', 'editor.lineHighlightBackground': '#FFFFFF10',
      // An empty string is not the default color: VS Code shows red (seen in Monokai Pro 2.0.17)
      'diffEditor.move.border': INVALID_COLOR,
    });
    assert.deepEqual(theme.warnings.map((w) => w.message), [
      '"editor.background" is not a hexadecimal color ("red"): VS Code shows #FF0000',
      '"editor.foreground" is not a hexadecimal color ("#FFFFF"): VS Code shows #FF0000',
      '"focusBorder" has characters that are not hexadecimal digits ("#GG0000"): VS Code reads them as 0, #000000',
      '"editorCursor.foreground" is a number, not a color: VS Code ignores it',
      '"editorLink.activeForeground" is null, not a color: VS Code ignores it',
      // Seen in GitHub Theme 6.3.5
      '"symbolIcon.constantForeground" is an array, not a color: VS Code ignores it',
      '"diffEditor.move.border" is not a hexadecimal color (""): VS Code shows #FF0000',
    ]);
  });
});

describe('semantic token styles that VS Code cannot read', () => {
  test('a color that is not hexadecimal, or a value that is not a style, gives a warning', () => {
    const dir = folder({ 'theme.json': { semanticTokenColors: { variable: 'blue', parameter: { foreground: '#12' }, property: { background: '#000000' }, label: true } } });
    const theme = loadTheme(join(dir, 'theme.json'));
    assert.deepEqual(theme.warnings.map((w) => w.message), [
      `"semanticTokenColors: variable" is not a hexadecimal color ("blue"): VS Code shows ${INVALID_COLOR}`,
      `"semanticTokenColors: parameter" is not a hexadecimal color ("#12"): VS Code shows ${INVALID_COLOR}`,
      '"semanticTokenColors: property" is neither a color nor a style: VS Code ignores it',
      '"semanticTokenColors: label" is neither a color nor a style: VS Code ignores it',
    ]);
    assert.equal(theme.semanticTokenColors.length, 4);
  });

  test('a style whose foreground is not a string makes VS Code refuse the theme', () => {
    const dir = folder({ 'theme.json': { semanticTokenColors: { variable: { foreground: null, bold: true } } } });
    assert.throws(() => loadTheme(join(dir, 'theme.json')), (error: unknown) => error instanceof ThemeError && /refuses this theme/.test(error.message));
    // Without a valid style property, VS Code ignores the value instead
    const ignored = folder({ 'theme.json': { semanticTokenColors: { variable: { foreground: 12 } } } });
    assert.equal(loadTheme(join(ignored, 'theme.json')).warnings.length, 1);
  });
});

describe('the old format: TextMate rules in "settings"', () => {
  test('a rule without scope sets workbench colors, and keeps only its foreground, background and font style', () => {
    const dir = folder({
      'theme.json': {
        settings: [
          { settings: { background: '#202020', foreground: '#DDDDDD', caret: '#FFCC00', lineHighlight: '#303030', ansiRed: '#FF5555' } },
          { scope: 'string', settings: { foreground: '#88CC88', caret: '#000000' } },
        ],
        colors: { 'editor.background': '#000000' },
      },
    });
    const theme = loadTheme(join(dir, 'theme.json'));
    assert.deepEqual(theme.colors, {
      'editor.background': '#202020', 'editor.foreground': '#DDDDDD', 'editorCursor.foreground': '#FFCC00',
      'editor.lineHighlightBackground': '#303030', 'terminal.ansiRed': '#FF5555',
    });
    // VS Code stops at "settings": "colors" in the same file is ignored
    assert.deepEqual(theme.tokenColors, [
      { settings: { background: '#202020', foreground: '#DDDDDD' } },
      { scope: 'string', settings: { foreground: '#88CC88', caret: '#000000' } },
    ]);
  });
});

describe('TextMate theme files', () => {
  test('are not supported yet, and the error says so', () => {
    const dir = folder({ 'theme.json': { tokenColors: './syntax.tmTheme' }, 'old.tmTheme': '<plist/>' });
    assert.throws(() => loadTheme(join(dir, 'theme.json')), /points to a TextMate theme file/);
    assert.throws(() => loadTheme(join(dir, 'old.tmTheme')), /not supported yet/);
  });

  test('tokenColors of another type is refused, as by VS Code', () => {
    const dir = folder({ 'theme.json': { tokenColors: { scope: 'comment' } } });
    assert.throws(() => loadTheme(join(dir, 'theme.json')), /expects 'tokenColors' to be an array/);
  });
});

describe('the themes of an extension folder', () => {
  test('read from package.json, with the defaults of VS Code', () => {
    const dir = folder({
      'package.json': {
        name: 'my-themes',
        contributes: {
          themes: [
            { label: '%theme.dark%', uiTheme: 'vs-dark', path: './themes/dark.json' },
            { label: 'Light', uiTheme: 'vs', path: './themes/light.json' },
            { path: './themes/no-type.json' },
            { label: 'No path', uiTheme: 'vs' },
          ],
        },
      },
      'package.nls.json': { 'theme.dark': 'My Dark' },
    });
    const { themes, warnings } = extensionThemes(dir);
    assert.deepEqual(themes, [
      { label: 'My Dark', uiTheme: 'vs-dark', path: join(dir, 'themes', 'dark.json') },
      { label: 'Light', uiTheme: 'vs', path: join(dir, 'themes', 'light.json') },
      // Without uiTheme, VS Code uses vs-dark; without label, the file name
      { label: 'no-type.json', uiTheme: 'vs-dark', path: join(dir, 'themes', 'no-type.json') },
    ]);
    assert.deepEqual(warnings.map((w) => w.message), [
      "./themes/no-type.json: 'uiTheme' is missing or unknown: VS Code uses vs-dark",
      "a theme has no 'path': VS Code ignores it",
    ]);
  });

  test('a folder without color themes is reported', () => {
    const dir = folder({ 'package.json': { name: 'icons', contributes: { iconThemes: [] } } });
    assert.throws(() => extensionThemes(dir), /contributes no color theme/);
  });
});
