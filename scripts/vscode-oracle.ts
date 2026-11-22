// Records the workbench colors that a real VS Code shows for the themes of some extensions: the CSS variables
// --vscode-<key> that the workbench writes for every registered color (generateColorThemeCSS of colorThemeCss.ts,
// which calls theme.getColor(id, true)). The tests compare the package with these colors.
//
//   node scripts/vscode-oracle.ts [options] <output.json> <extension folder>...
//
//   --code <path>   The VS Code executable (default on macOS: /Applications/Visual Studio Code.app/Contents/MacOS/Code)
//   --keys <file>   Only record these color ids, one per line ('#' starts a comment)
//   --work <folder> Where to make the temporary profile (default: the temporary folder of the system). The path of
//                   the IPC socket of VS Code, in this folder, must stay under 104 characters.
//   --port <port>   The local port for remote debugging (default 9337)
//
// VS Code runs with a temporary profile (user data and extensions folders, deleted at the end), the extensions loaded
// with --extensionDevelopmentPath from copies without code (no `main` or `browser`), and remote debugging on a
// local port. Each theme is selected by writing workbench.colorTheme in the settings of the temporary profile.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { Color } from '../src/colors.ts';
import { extensionThemes, loadTheme } from '../src/theme.ts';
import { BASE_SETTINGS, MACOS_CODE, Session, copyExtension, launch, settingsId, sleep, vscodeVersion, workbenchPage, writeUserFile } from './vscode-run.ts';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    code: { type: 'string', default: MACOS_CODE },
    keys: { type: 'string' },
    work: { type: 'string', default: tmpdir() },
    port: { type: 'string', default: '9337' },
  },
});
const [output, ...folders] = positionals;
if (!output || folders.length === 0) {
  process.stderr.write('Usage: node scripts/vscode-oracle.ts [--code <path>] [--keys <file>] [--work <folder>] <output.json> <extension folder>...\n');
  process.exit(2);
}

/** The name of the CSS variable of a color, without --vscode- (asCssVariableName of colorUtils.ts). */
function cssName(key: string): string {
  return key.replace(/\./g, '-');
}

const keys = options.keys === undefined ? undefined : readFileSync(options.keys, 'utf8').split('\n')
  .map((line) => line.replace(/#.*/, '').trim()).filter((line) => line.length > 0);

const { version, commit } = vscodeVersion(options.code);

mkdirSync(options.work, { recursive: true });
const work = mkdtempSync(join(options.work, 'vto-'));
const userData = join(work, 'user-data');
function writeSettings(theme: string): void {
  writeUserFile(userData, 'settings.json', { ...BASE_SETTINGS, 'workbench.colorTheme': theme });
}

interface Entry { extension: string; settingsId: string; label: string; path: string; uiTheme: string; colors: Record<string, string> }
const entries: Entry[] = [];
const copies: string[] = [];
for (const [i, folder] of folders.entries()) {
  const { copy, manifest } = copyExtension(folder, work, i);
  copies.push(copy);
  for (const theme of extensionThemes(folder).themes) {
    let colors: Record<string, string> = {};
    try {
      colors = loadTheme(theme.path).colors;
    } catch {
      // A theme that the package refuses: VS Code is still asked
    }
    entries.push({
      extension: relative(process.cwd(), folder) || '.', settingsId: settingsId(folder, manifest, theme),
      label: theme.label, path: relative(resolve(folder), theme.path), uiTheme: theme.uiTheme, colors,
    });
  }
}
const used = new Map<string, number>();
for (const entry of entries) used.set(entry.settingsId, (used.get(entry.settingsId) ?? 0) + 1);

// Start on a built-in theme: at startup, VS Code applies the setting before it loads the extensions, and keeps its
// fallback theme
writeSettings('Default High Contrast');
const child = launch(options.code, work, options.port, copies);

// The rule `.monaco-workbench { --vscode-...: ...; }` that VS Code writes for the theme, as an object
const READ_CSS = `(() => {
  const found = {};
  for (const style of document.querySelectorAll('style')) {
    const text = style.textContent || '';
    if (!text.includes('--vscode-foreground:')) continue;
    for (const match of text.matchAll(/--vscode-([^:\\s]+):\\s*([^;]+);/g)) found[match[1]] = match[2].trim();
  }
  return found;
})()`;
// The classes of .monaco-workbench name the theme (classNames of colorThemeData.ts): they change with the theme
const READ_CLASSES = "document.querySelector('.monaco-workbench')?.className ?? ''";

/** Selects a theme, then waits until VS Code shows it and its CSS is stable. */
async function show(session: Session, entry: Entry, previous: string): Promise<{ applied: boolean; classes: string; css: Record<string, string> }> {
  writeSettings(entry.settingsId);
  // A color that the theme sets and that VS Code does not show means that another theme is still shown
  const wrong = (css: Record<string, string>) => Object.entries(entry.colors).some(([key, value]) => {
    const shown = css[cssName(key)];
    return shown !== undefined && shown !== Color.fromHex(value).toCss();
  });
  let css: Record<string, string> = {};
  let classes = previous;
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(250);
    classes = await session.evaluate(READ_CLASSES) as string;
    if (classes === previous) continue;
    css = await session.evaluate(READ_CSS) as Record<string, string>;
    if (wrong(css)) continue;
    await sleep(300);
    if (JSON.stringify(await session.evaluate(READ_CSS)) === JSON.stringify(css)) return { applied: true, classes, css };
  }
  return { applied: false, classes, css };
}

const themes: (Omit<Entry, 'colors'> & { applied: boolean; colors: Record<string, string | null> })[] = [];
try {
  const session = await Session.open(await workbenchPage(options.port));
  // The extensions load after the window: a theme selected before is not found, and VS Code shows another one
  await sleep(5000);
  let previous = await session.evaluate(READ_CLASSES) as string;
  for (const entry of entries) {
    if ((used.get(entry.settingsId) ?? 0) > 1) {
      process.stderr.write(`skipped, two themes have this name: ${entry.settingsId} (${entry.extension})\n`);
      continue;
    }
    let result = await show(session, entry, previous);
    if (!result.applied) {
      // Once more, from a built-in theme
      writeSettings('Default High Contrast');
      await sleep(3000);
      result = await show(session, entry, await session.evaluate(READ_CLASSES) as string);
    }
    previous = result.classes;
    // Without --keys, every CSS variable, by its name; with --keys, these colors by id, null when VS Code has none
    const colors: Record<string, string | null> = keys
      ? Object.fromEntries(keys.map((key) => [key, result.css[cssName(key)] ?? null]))
      : result.css;
    const { extension, settingsId, label, path, uiTheme } = entry;
    themes.push({ extension, settingsId, label, path, uiTheme, applied: result.applied, colors });
    process.stderr.write(`${result.applied ? 'ok' : 'NOT APPLIED'}: ${entry.label} (${entry.extension})\n`);
  }
  session.close();
} finally {
  child.kill();
  await sleep(1000);
  rmSync(work, { recursive: true, force: true });
}

writeFileSync(output, JSON.stringify({ vscode: { version, commit }, themes }, null, 2) + '\n');
process.stderr.write(`${String(themes.length)} themes written to ${output}\n`);
