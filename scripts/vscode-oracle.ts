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

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { Color } from '../src/colors.ts';
import { extensionThemes, loadTheme } from '../src/theme.ts';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    code: { type: 'string', default: '/Applications/Visual Studio Code.app/Contents/MacOS/Code' },
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

// The version of VS Code: resources/app next to the executable, or Contents/Resources/app on macOS
const app = options.code.includes('.app/Contents/MacOS/')
  ? resolve(dirname(options.code), '../Resources/app')
  : resolve(dirname(options.code), 'resources/app');
const { commit } = JSON.parse(readFileSync(join(app, 'product.json'), 'utf8')) as { commit: string };
const { version } = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as { version: string };

mkdirSync(options.work, { recursive: true });
const work = mkdtempSync(join(options.work, 'vto-'));
const userData = join(work, 'user-data');
const baseSettings = {
  'window.restoreWindows': 'none', 'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off',
  'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
  'workbench.enableExperiments': false, 'security.workspace.trust.enabled': false, 'chat.disableAIFeatures': true,
};
function writeSettings(theme: string): void {
  mkdirSync(join(userData, 'User'), { recursive: true });
  writeFileSync(join(userData, 'User', 'settings.json'), JSON.stringify({ ...baseSettings, 'workbench.colorTheme': theme }, null, 2));
}

interface Entry { extension: string; settingsId: string; label: string; path: string; uiTheme: string; colors: Record<string, string> }
const entries: Entry[] = [];
const copies: string[] = [];
for (const [i, folder] of folders.entries()) {
  // A copy without code: some theme extensions write their theme files when they run
  const copy = join(work, 'extensions', `${String(i)}-${basename(resolve(folder))}`);
  cpSync(folder, copy, { recursive: true, dereference: true, filter: (source) => !/[/\\](node_modules|\.git)([/\\]|$)/.test(source) });
  const manifestFile = join(copy, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { contributes?: { themes?: { id?: unknown; path?: unknown }[] } } & Record<string, unknown>;
  for (const key of ['main', 'browser', 'activationEvents', 'extensionDependencies', 'extensionPack']) Reflect.deleteProperty(manifest, key);
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  copies.push(copy);
  const contributed = manifest.contributes?.themes ?? [];
  for (const theme of extensionThemes(folder).themes) {
    // workbench.colorTheme names a theme by its `id` when it has one, otherwise by its label (settingsId of VS Code)
    const id = contributed.find((c) => typeof c.path === 'string' && resolve(folder, c.path) === theme.path)?.id;
    let colors: Record<string, string> = {};
    try {
      colors = loadTheme(theme.path).colors;
    } catch {
      // A theme that the package refuses: VS Code is still asked
    }
    entries.push({
      extension: relative(process.cwd(), folder) || '.', settingsId: typeof id === 'string' ? id : theme.label,
      label: theme.label, path: relative(resolve(folder), theme.path), uiTheme: theme.uiTheme, colors,
    });
  }
}
const used = new Map<string, number>();
for (const entry of entries) used.set(entry.settingsId, (used.get(entry.settingsId) ?? 0) + 1);

// Start on a built-in theme: at startup, VS Code applies the setting before it loads the extensions, and keeps its
// fallback theme
writeSettings('Default High Contrast');
const child = spawn(options.code, [
  `--user-data-dir=${userData}`, `--extensions-dir=${join(work, 'extensions-installed')}`,
  `--remote-debugging-port=${options.port}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
  '--disable-telemetry', '--new-window', ...copies.map((copy) => `--extensionDevelopmentPath=${copy}`),
], {
  stdio: 'ignore',
  // Variables of a VS Code that runs this script: ELECTRON_RUN_AS_NODE would start VS Code as Node.js
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('VSCODE_'))),
});

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The WebSocket of the workbench page, once VS Code has started. */
async function workbenchPage(): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${options.port}/json/list`);
      const targets = await response.json() as { type: string; url: string; webSocketDebuggerUrl: string }[];
      const target = targets.find((t) => t.type === 'page' && t.url.includes('workbench'));
      if (target) return target.webSocketDebuggerUrl;
    } catch {
      // Not started yet
    }
    await sleep(500);
  }
  throw new Error('VS Code did not start');
}

/** A Chrome DevTools Protocol session, to evaluate expressions in the page. */
class Session {
  private readonly socket: WebSocket;
  private id = 0;
  private readonly pending = new Map<number, (value: unknown) => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
      if (message.id !== undefined) this.pending.get(message.id)?.(message.result);
    });
  }

  static async open(url: string): Promise<Session> {
    const socket = new WebSocket(url);
    await new Promise((done, reject) => {
      socket.addEventListener('open', done);
      socket.addEventListener('error', reject);
    });
    return new Session(socket);
  }

  async evaluate(expression: string): Promise<unknown> {
    const id = ++this.id;
    const result = new Promise((done) => this.pending.set(id, done));
    this.socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    return ((await result) as { result: { value: unknown } }).result.value;
  }

  close(): void {
    this.socket.close();
  }
}

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
  const session = await Session.open(await workbenchPage());
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
