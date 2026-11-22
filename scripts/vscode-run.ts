// Runs a real VS Code for scripts/vscode-oracle.ts and scripts/vscode-inspect.ts: a temporary profile, theme
// extensions loaded from copies without their code, and a Chrome DevTools Protocol session on the workbench page,
// through remote debugging on a local port.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** The VS Code executable on macOS, when it is installed in /Applications. */
export const MACOS_CODE = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';

/** Settings of the temporary profile, so that nothing but the themes changes what VS Code shows. */
export const BASE_SETTINGS = {
  'window.restoreWindows': 'none', 'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off',
  'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
  'workbench.enableExperiments': false, 'security.workspace.trust.enabled': false, 'chat.disableAIFeatures': true,
};

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The version and the commit of a VS Code executable: resources/app next to it, or Contents/Resources/app on macOS. */
export function vscodeVersion(code: string): { version: string; commit: string } {
  const app = code.includes('.app/Contents/MacOS/') ? resolve(dirname(code), '../Resources/app') : resolve(dirname(code), 'resources/app');
  const { commit } = JSON.parse(readFileSync(join(app, 'product.json'), 'utf8')) as { commit: string };
  const { version } = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as { version: string };
  return { version, commit };
}

/** The settings and key bindings files of the temporary profile. */
export function writeUserFile(userData: string, name: 'settings.json' | 'keybindings.json', value: unknown): void {
  mkdirSync(join(userData, 'User'), { recursive: true });
  writeFileSync(join(userData, 'User', name), JSON.stringify(value, null, 2));
}

export type Manifest = { contributes?: { themes?: { id?: unknown; path?: unknown }[] } } & Record<string, unknown>;

/**
 * Copies an extension into the work folder without its code (no `main` or `browser`): some theme extensions write
 * their theme files when they run. Returns the copy and its manifest.
 */
export function copyExtension(folder: string, work: string, index: number): { copy: string; manifest: Manifest } {
  const copy = join(work, 'extensions', `${String(index)}-${basename(resolve(folder))}`);
  cpSync(folder, copy, { recursive: true, dereference: true, filter: (source) => !/[/\\](node_modules|\.git)([/\\]|$)/.test(source) });
  const manifestFile = join(copy, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest;
  for (const key of ['main', 'browser', 'activationEvents', 'extensionDependencies', 'extensionPack']) Reflect.deleteProperty(manifest, key);
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return { copy, manifest };
}

/**
 * The value of workbench.colorTheme that selects a theme: its `id` when it has one, otherwise its label (settingsId
 * of VS Code).
 */
export function settingsId(folder: string, manifest: Manifest, theme: { path: string; label: string }): string {
  const id = (manifest.contributes?.themes ?? []).find((c) => typeof c.path === 'string' && resolve(folder, c.path) === theme.path)?.id;
  return typeof id === 'string' ? id : theme.label;
}

/** Starts VS Code with a temporary profile, the extension copies, and remote debugging on a local port. */
export function launch(code: string, work: string, port: string, copies: readonly string[], paths: readonly string[] = []): ChildProcess {
  return spawn(code, [
    `--user-data-dir=${join(work, 'user-data')}`, `--extensions-dir=${join(work, 'extensions-installed')}`,
    `--remote-debugging-port=${port}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
    '--disable-telemetry', '--new-window', ...copies.map((copy) => `--extensionDevelopmentPath=${copy}`), ...paths,
  ], {
    stdio: 'ignore',
    // Variables of a VS Code that runs this script: ELECTRON_RUN_AS_NODE would start VS Code as Node.js
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('VSCODE_'))),
  });
}

/** The WebSocket of the workbench page, once VS Code has started. */
export async function workbenchPage(port: string): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
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

/** Reads a value again every 100 ms, until it is right or the time is over; returns the last value read. */
export async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeout = 15000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() > end) return value;
    await sleep(100);
  }
}

/** A Chrome DevTools Protocol session: expressions evaluated in the page, keys and clicks sent to it. */
export class Session {
  private readonly socket: WebSocket;
  private id = 0;
  private readonly pending = new Map<number, (value: unknown) => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: unknown; result?: unknown };
      // Only the answers to our own requests: a number id that one of them is waiting for
      if (typeof message.id !== 'number') return;
      const done = this.pending.get(message.id);
      if (typeof done !== 'function') return;
      this.pending.delete(message.id);
      done(message.result);
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

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.id;
    const result = new Promise((done) => this.pending.set(id, done));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate(expression: string): Promise<unknown> {
    return ((await this.send('Runtime.evaluate', { expression, returnByValue: true })) as { result: { value: unknown } }).result.value;
  }

  /** Presses a key. Modifiers: 1 Alt, 2 Control, 4 Meta (Command), 8 Shift. */
  async key(key: string, code: string, keyCode: number, modifiers = 0): Promise<void> {
    const event = { modifiers, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
  }

  async click(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  close(): void {
    this.socket.close();
  }
}
