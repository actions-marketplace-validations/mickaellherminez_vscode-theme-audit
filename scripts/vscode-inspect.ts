// Records the token styles that a real VS Code shows, with its own grammars, language servers and themes. For each
// token of some sample files, it reads what the widget of "Developer: Inspect Editor Tokens and Scopes" says (the
// TextMate scopes, the semantic token type and modifiers, the color) and the style of the text on screen. The test
// test/corpus/inspect.test.ts gives these scopes and semantic tokens to the package, which must find the same style.
//
//   node scripts/vscode-inspect.ts [options] <output.json> <samples folder> <extension folder>...
//
//   --theme <label> Only record this theme (repeatable; default: every theme of the extensions)
//   --code <path>   The VS Code executable (default on macOS: /Applications/Visual Studio Code.app/Contents/MacOS/Code)
//   --work <folder> Where to make the temporary profile (default: the temporary folder of the system). The path of
//                   the IPC socket of VS Code, in this folder, must stay under 104 characters.
//   --port <port>   The local port for remote debugging (default 9338)
//
// VS Code runs as for scripts/vscode-oracle.ts (scripts/vscode-run.ts): a temporary profile, deleted at the end, and
// the extensions loaded from copies without their code. It opens a copy of the samples folder. Each file is opened
// with Quick Open and the widget with a key binding of the temporary profile; then each word, and each run of other
// characters, is clicked, so that the widget shows its token. The window must stay open until the script ends.

import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { extensionThemes } from '../src/theme.ts';
import { BASE_SETTINGS, MACOS_CODE, Session, copyExtension, launch, settingsId, sleep, until, vscodeVersion, workbenchPage, writeUserFile } from './vscode-run.ts';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    theme: { type: 'string', multiple: true },
    code: { type: 'string', default: MACOS_CODE },
    work: { type: 'string', default: tmpdir() },
    port: { type: 'string', default: '9338' },
  },
});
const [output, samples, ...folders] = positionals;
if (!output || !samples || folders.length === 0) {
  process.stderr.write('Usage: node scripts/vscode-inspect.ts [--theme <label>]... [--code <path>] [--work <folder>] [--port <port>] <output.json> <samples folder> <extension folder>...\n');
  process.exit(2);
}

/** The key that opens the widget, bound in the temporary profile: Control+Alt+Shift+F9. */
const INSPECT_KEY = { binding: 'ctrl+shift+alt+f9', key: 'F9', code: 'F9', keyCode: 120, modifiers: 1 | 2 | 8 };

/**
 * Editor settings that keep other colors and decorations off the text, so that it shows the token style alone:
 * bracket pair colors, faded unused code, struck through deprecated code, inlay hints, links... Tree-sitter stays
 * off, as it is by default.
 */
const EDITOR_SETTINGS = {
  'editor.bracketPairColorization.enabled': false, 'editor.showUnused': false, 'editor.showDeprecated': false,
  'editor.hover.enabled': false, 'editor.inlayHints.enabled': 'off', 'editor.codeLens': false,
  'editor.lightbulb.enabled': 'off', 'editor.links': false, 'editor.colorDecorators': false,
  'editor.occurrencesHighlight': 'off', 'editor.selectionHighlight': false, 'editor.matchBrackets': 'never',
  'editor.stickyScroll.enabled': false, 'editor.minimap.enabled': false, 'editor.wordWrap': 'off',
  'editor.renderWhitespace': 'none', 'editor.renderLineHighlight': 'none', 'editor.guides.indentation': false,
  'editor.unicodeHighlight.ambiguousCharacters': false, 'editor.unicodeHighlight.invisibleCharacters': false,
  'editor.quickSuggestions': { other: 'off', comments: 'off', strings: 'off' }, 'editor.parameterHints.enabled': false,
  'editor.fontSize': 13, 'editor.lineHeight': 20, 'editor.cursorBlinking': 'solid',
  'editor.experimental.preferTreeSitter.typescript': false, 'editor.experimental.treeSitterTelemetry': false,
  'workbench.editor.enablePreview': false, 'window.newWindowDimensions': 'maximized', 'git.enabled': false,
};

const { version, commit } = vscodeVersion(options.code);

mkdirSync(options.work, { recursive: true });
const work = mkdtempSync(join(options.work, 'vti-'));
const userData = join(work, 'user-data');
function writeSettings(theme: string): void {
  writeUserFile(userData, 'settings.json', { ...BASE_SETTINGS, ...EDITOR_SETTINGS, 'workbench.colorTheme': theme });
}

interface Entry { id: string; version: string; settingsId: string; label: string; path: string; uiTheme: string }
const entries: Entry[] = [];
const copies: string[] = [];
for (const [i, folder] of folders.entries()) {
  const { copy, manifest } = copyExtension(folder, work, i);
  copies.push(copy);
  const id = `${String(manifest.publisher)}.${String(manifest.name)}`;
  for (const theme of extensionThemes(folder).themes) {
    if (options.theme && !options.theme.includes(theme.label)) continue;
    entries.push({
      id, version: String(manifest.version), settingsId: settingsId(folder, manifest, theme), label: theme.label,
      path: relative(resolve(folder), theme.path).split('\\').join('/'), uiTheme: theme.uiTheme,
    });
  }
}
for (const label of options.theme ?? []) {
  if (!entries.some((entry) => entry.label === label)) throw new Error(`No theme with this label: ${label}`);
}

const workspace = join(work, 'samples');
cpSync(samples, workspace, { recursive: true });
const files = readdirSync(workspace).filter((name) => !name.startsWith('.')).sort();

// Start on a built-in theme: at startup, VS Code applies the setting before it loads the extensions
writeSettings('Default High Contrast');
writeUserFile(userData, 'keybindings.json', [{ key: INSPECT_KEY.binding, command: 'editor.action.inspectTMScopes', when: 'editorTextFocus' }]);
const child = launch(options.code, work, options.port, copies, [workspace]);

// The classes of .monaco-workbench name the theme (classNames of colorThemeData.ts): they change with the theme
const READ_CLASSES = "document.querySelector('.monaco-workbench')?.className ?? ''";
const CURSOR = "document.querySelector('[id=\"status.editor.selection\"]')?.innerText ?? ''";

/**
 * The text on screen, in the places to click: in each span of each line (one style), the start of each word and of
 * each other run of characters that are not spaces, since tokens start there. Each place has its line, column, text
 * and style on screen (the color as #RRGGBB, or #RRGGBBAA with transparency).
 */
const READ_PLACES = `(() => {
  const editor = document.querySelector('.editor-group-container.active .monaco-editor');
  if (!editor) return [];
  const lineHeight = parseFloat(getComputedStyle(editor.querySelector('.view-line')).height);
  const hex = (css) => {
    const [r, g, b, a] = css.match(/[\\d.]+/g).map(Number);
    const two = (n) => Math.round(n).toString(16).padStart(2, '0');
    return ('#' + two(r) + two(g) + two(b) + (a === undefined || a === 1 ? '' : two(a * 255))).toUpperCase();
  };
  const places = [];
  for (const line of editor.querySelectorAll('.view-lines > .view-line')) {
    const lineNumber = Math.round(parseFloat(line.style.top) / lineHeight) + 1;
    let column = 1;
    for (const span of line.querySelectorAll(':scope > span > span')) {
      const text = span.textContent.replace(/\\u00a0/g, ' ');
      const style = getComputedStyle(span);
      const shown = {
        foreground: hex(style.color), bold: Number(style.fontWeight) >= 600, italic: style.fontStyle === 'italic',
        underline: style.textDecorationLine.includes('underline'),
        strikethrough: style.textDecorationLine.includes('line-through'),
      };
      for (const match of text.matchAll(/\\w+|[^\\w\\s]+/g)) {
        const range = document.createRange();
        range.setStart(span.firstChild, match.index);
        range.setEnd(span.firstChild, match.index + 1);
        const rect = range.getBoundingClientRect();
        places.push({ line: lineNumber, column: column + match.index, text: match[0], x: rect.left + 1, y: rect.top + rect.height / 2, shown });
      }
      column += text.length;
    }
  }
  return places;
})()`;

/** Marks the content of the widget as old before the cursor moves: the widget clears it when it computes again. */
const MARK_WIDGET = `(() => {
  const widget = document.querySelector('.token-inspect-widget');
  if (widget) widget.appendChild(Object.assign(document.createElement('i'), { className: 'vti-old' }));
})()`;

/** The rows of the widget, once computed, as [key, value] in each of its tables; null while it computes. */
const READ_WIDGET = `(() => {
  const widget = document.querySelector('.token-inspect-widget');
  if (!widget || widget.querySelector('.vti-old') || widget.textContent === 'Loading...') return null;
  return [...widget.querySelectorAll('table.tiw-metadata-table')].map((table) =>
    [...table.querySelectorAll(':scope > tbody > tr')].map((row) => [...row.children].map((cell) => cell.innerText)));
})()`;

interface Style { foreground: string; bold: boolean; italic: boolean; underline: boolean; strikethrough: boolean }
interface Place { line: number; column: number; text: string; x: number; y: number; shown: Style }

/** What the package needs from the widget, and the style that VS Code gives. */
interface Token {
  file: string;
  line: number;
  column: number;
  text: string;
  /** The language of the TextMate token (an embedded language in a Markdown code block, for example). */
  language: string;
  /** The TextMate scopes, outermost first, as the package takes them. */
  scopes: string[];
  semantic?: { type: string; modifiers: string[] };
  /** The color of the widget: the semantic one, or else the TextMate one, as VS Code writes it in its color map. */
  foreground: string;
  /** The style of the text on screen. */
  shown: Style;
}

function parseWidget(tables: string[][][], file: string, place: Omit<Place, 'x' | 'y'>): Token {
  const value = (key: string) => tables.flat().find(([k]) => k === key)?.[1];
  const scopes = value('textmate scopes');
  const foreground = value('foreground');
  if (scopes === undefined || foreground === undefined) throw new Error(`${file}:${String(place.line)}:${String(place.column)}: no TextMate scopes or color in the widget`);
  const type = value('semantic token type');
  const modifiers = value('modifiers');
  const { shown, ...rest } = place;
  return {
    file, ...rest, language: value('language') ?? '',
    scopes: scopes.split('\n').filter((scope) => scope.length > 0).reverse(),
    ...(type === undefined ? {} : { semantic: { type, modifiers: modifiers === undefined ? [] : modifiers.split(' ') } }),
    foreground: foreground.toUpperCase(), shown,
  };
}

const readPlaces = async (session: Session) => await session.evaluate(READ_PLACES) as Place[];
const styles = (places: Place[]) => JSON.stringify(places.map(({ line, column, shown }) => [line, column, shown]));

/**
 * Opens a file with Quick Open; three attempts, since Quick Open can miss the first keys while the window is busy. The
 * window title then names the file, after "[Extension Development Host]" once the extensions have loaded.
 */
async function openFile(session: Session, name: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await session.key('p', 'KeyP', 80, process.platform === 'darwin' ? 4 : 2);
    await sleep(500);
    await session.send('Input.insertText', { text: name });
    await sleep(800);
    await session.key('Enter', 'Enter', 13);
    const title = await until(() => session.evaluate('document.title') as Promise<string>, (value) => value.includes(name + ' '), 5000);
    if (title.includes(name + ' ')) return;
    await session.key('Escape', 'Escape', 27);
    await sleep(1000);
  }
  throw new Error(`${name} did not open (window title: ${String(await session.evaluate('document.title'))})`);
}

/** Waits until the text keeps the same styles for 2 seconds: a language server colors it later than the grammar. */
async function settle(session: Session): Promise<Place[]> {
  let places = await readPlaces(session);
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(2000);
    const again = await readPlaces(session);
    if (again.length > 0 && styles(again) === styles(places)) return again;
    places = again;
  }
  throw new Error('The styles of the text did not settle');
}

/** Clicks each place and reads the widget; undefined when the styles on screen changed meanwhile. */
async function inspect(session: Session, file: string, places: Place[]): Promise<Token[] | undefined> {
  // Start from the last place, so that the first click moves the cursor and the widget computes again
  const last = places[places.length - 1];
  if (!last) throw new Error(`${file}: no text on screen`);
  await session.click(last.x, last.y);
  await session.key(INSPECT_KEY.key, INSPECT_KEY.code, INSPECT_KEY.keyCode, INSPECT_KEY.modifiers);
  await until(() => session.evaluate(READ_WIDGET), (widget) => widget !== null);
  const tokens: Token[] = [];
  for (const { x, y, ...place } of places) {
    const expected = `Ln ${String(place.line)}, Col ${String(place.column)}`;
    let tables: string[][][] | null = null;
    // The status bar shows the cursor a little later than the widget: it must reach the place clicked
    for (let attempt = 0; attempt < 2 && tables === null; attempt++) {
      await session.evaluate(MARK_WIDGET);
      await session.click(x, y);
      const widget = await until(() => session.evaluate(READ_WIDGET) as Promise<string[][][] | null>, (value) => value !== null, 5000);
      const cursor = await until(() => session.evaluate(CURSOR) as Promise<string>, (value) => value === expected, 2000);
      if (cursor === expected) tables = widget;
    }
    if (tables === null) throw new Error(`${file}: the click did not reach ${expected} (${place.text})`);
    tokens.push(parseWidget(tables, file, place));
  }
  await session.key('Escape', 'Escape', 27);
  return styles(await readPlaces(session)) === styles(places) ? tokens : undefined;
}

/** One token for each language, scopes and semantic token, unless VS Code showed them in two styles. */
function distinct(tokens: Token[]): Token[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    const key = JSON.stringify([token.language, token.scopes, token.semantic, token.foreground, token.shown]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const themes = [];
let opened: Session | undefined;
try {
  const session = await Session.open(await workbenchPage(options.port));
  opened = session;
  // Keys and focus reach the window even when another application is in front
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Clicks reach the text under the widget
  await session.evaluate("document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.token-inspect-widget { pointer-events: none; }' }))");
  // The extensions load after the window
  await sleep(5000);
  let previous = await session.evaluate(READ_CLASSES) as string;
  for (const entry of entries) {
    writeSettings(entry.settingsId);
    // The first theme waits for the extensions, which load after the window
    const classes = await until(() => session.evaluate(READ_CLASSES) as Promise<string>, (value) => value !== previous, 60000);
    if (classes === previous) throw new Error(`${entry.label} was not applied`);
    previous = classes;
    // The new token colors reach the editor a little later
    await sleep(1500);
    const tokens: Token[] = [];
    for (const name of files) {
      await openFile(session, name);
      let found: Token[] | undefined;
      for (let attempt = 0; attempt < 3 && !found; attempt++) found = await inspect(session, name, await settle(session));
      if (!found) throw new Error(`The styles of ${name} kept changing`);
      tokens.push(...found);
      const semantic = found.filter((token) => token.semantic).length;
      process.stderr.write(`${entry.label}: ${name}, ${String(found.length)} places, ${String(semantic)} with a semantic token\n`);
    }
    const { id, version: extensionVersion, label, path, uiTheme } = entry;
    themes.push({ id, version: extensionVersion, label, path, uiTheme, places: tokens.length, tokens: distinct(tokens) });
  }
  session.close();
} catch (error) {
  // What the window showed, to understand the failure
  const shot = await opened?.send('Page.captureScreenshot', { format: 'png' }) as { data?: string } | undefined;
  if (shot?.data !== undefined) {
    const file = join(options.work, 'vscode-inspect-failure.png');
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    process.stderr.write(`screenshot of the window: ${file}\n`);
  }
  throw error;
} finally {
  child.kill();
  await sleep(1000);
  rmSync(work, { recursive: true, force: true });
}

// One token per line, to read the file and its diffs
const lines = [
  '{',
  `  "vscode": ${JSON.stringify({ version, commit, platform: process.platform })},`,
  `  "settings": ${JSON.stringify(EDITOR_SETTINGS)},`,
  '  "themes": [',
  themes.map(({ tokens, ...theme }) => [
    `    ${JSON.stringify(theme).slice(0, -1)}, "tokens": [`,
    tokens.map((token) => `      ${JSON.stringify(token)}`).join(',\n'),
    '    ]}',
  ].join('\n')).join(',\n'),
  '  ]',
  '}',
];
writeFileSync(output, lines.join('\n') + '\n');
process.stderr.write(`${String(themes.length)} themes written to ${output}\n`);
