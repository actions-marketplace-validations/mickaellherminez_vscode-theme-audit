// Five themes of the corpus, checked against the editor of VS Code itself: test/data/vscode-inspect.json records,
// for each token of the samples of test/data/inspect/, the TextMate scopes and the semantic token that the widget
// "Developer: Inspect Editor Tokens and Scopes" showed, with the style of the text on screen. Given these scopes and
// semantic tokens, the package must find the same color and font style. scripts/vscode-inspect.ts records the file.
// `npm run test:corpus` runs this test, after the download of the corpus.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';

import { SemanticTokenColors, withSemantic } from '../../src/semantic.ts';
import { loadTheme } from '../../src/theme.ts';
import type { UiTheme } from '../../src/theme.ts';
import { TokenColors } from '../../src/tokens.ts';
import { extractVsix, readList, vsixPath } from './corpus.ts';

interface Style { foreground: string; bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean }
interface Token {
  file: string;
  line: number;
  column: number;
  text: string;
  language: string;
  scopes: string[];
  semantic?: { type: string; modifiers: string[] };
  foreground: string;
  shown: Style;
}
interface Recorded { id: string; version: string; label: string; path: string; uiTheme: UiTheme; places: number; tokens: Token[] }

const RECORD = new URL('../data/vscode-inspect.json', import.meta.url);
const record = JSON.parse(readFileSync(RECORD, 'utf8')) as { vscode: { version: string; commit: string }; themes: Recorded[] };
const { extensions } = readList();

const temp = mkdtempSync(join(tmpdir(), 'vscode-theme-audit-inspect-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });

test('the record comes from the pinned release of VS Code, on themes of the corpus at its versions', () => {
  assert.equal(record.vscode.version, '1.147.0');
  assert.match(record.vscode.commit, /^8a14f0cc1b/);
  for (const theme of record.themes) {
    assert.equal(extensions.find((e) => e.id === theme.id)?.version, theme.version, theme.id);
  }
});

for (const theme of record.themes) {
  test(`${theme.label} (${theme.uiTheme}): ${String(theme.tokens.length)} distinct tokens of ${String(theme.places)} places`, async () => {
    const extension = extensions.find((e) => e.id === theme.id);
    assert.ok(extension, `${theme.id} is not in the corpus`);
    const vsix = vsixPath(extension);
    assert.ok(existsSync(vsix), `${relative(process.cwd(), vsix)} is missing: run npm run corpus`);
    const folder = join(temp, extension.id);
    if (!existsSync(folder)) await extractVsix(vsix, folder);
    const loaded = loadTheme(join(folder, theme.path));
    const textMate = new TokenColors(loaded, theme.uiTheme);
    const semantic = new SemanticTokenColors(loaded, theme.uiTheme);
    // Semantic rules match the language of the file, as VS Code gives it: that of its first token
    const languages = new Map<string, string>();
    for (const token of theme.tokens) if (!languages.has(token.file)) languages.set(token.file, token.language);

    const differences: string[] = [];
    for (const token of theme.tokens) {
      const where = `${token.file}:${String(token.line)}:${String(token.column)} ${JSON.stringify(token.text)}`;
      // The widget and the screen agree: the record is consistent
      if (token.shown.foreground !== token.foreground) differences.push(`${where}: the widget shows ${token.foreground}, the screen ${token.shown.foreground}`);
      const style = withSemantic(textMate.style(token.scopes),
        token.semantic ? semantic.style(token.semantic.type, token.semantic.modifiers, languages.get(token.file)) : undefined);
      const found = { ...style, foreground: style.foreground.toUpperCase() };
      const expected: Style = { ...token.shown, foreground: token.foreground };
      for (const key of ['foreground', 'bold', 'italic', 'underline', 'strikethrough'] as const) {
        if (found[key] !== expected[key]) differences.push(`${where}: ${key} ${String(found[key])}, VS Code ${String(expected[key])} (${token.scopes.join(' ')}${token.semantic ? `, ${token.semantic.type} ${token.semantic.modifiers.join(' ')}` : ''})`);
      }
    }
    assert.deepEqual(differences, []);
  });
}
