// src/textmate.ts gives the same styles as vscode-textmate itself, the library that colors code in VS Code, on
// themes and scope paths generated at random (fixed seed): parent scopes, '>', commas, font styles, invalid colors.
// vscode-textmate does not export its theme: a one-pattern grammar gives each scope path to the tokenizer, which
// encodes the style of the token in its metadata (EncodedTokenAttributes: font style at bit 11, foreground id at bit
// 15, background id at bit 24).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { before, test } from 'node:test';

import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

import { TextMateTheme } from '../src/textmate.ts';
import type { RawRule } from '../src/textmate.ts';

const require = createRequire(import.meta.url);
let onigLib: Promise<textmate.IOnigLib>;

before(async () => {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  onigLib = Promise.resolve({
    createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
    createOnigString: (text) => new oniguruma.OnigString(text),
  });
});

/** Styles that vscode-textmate gives to scope paths (outermost first) with these rules. */
async function referenceStyles(rules: RawRule[], paths: string[][]) {
  const result = [];
  for (const [root = 'source', ...rest] of paths) {
    const grammar = { scopeName: root, patterns: rest.length ? [{ match: 'x', name: rest.join(' ') }] : [] };
    const registry = new textmate.Registry({ onigLib, loadGrammar: () => Promise.resolve(grammar as unknown as textmate.IRawGrammar) });
    registry.setTheme({ settings: rules } as unknown as textmate.IRawTheme);
    const loaded = await registry.loadGrammar(root);
    assert.ok(loaded);
    const metadata = loaded.tokenizeLine2('x', textmate.INITIAL).tokens[1] ?? 0;
    const colors = registry.getColorMap();
    result.push({ fontStyle: (metadata >>> 11) & 0b1111, foreground: colors[(metadata >>> 15) & 0x1ff], background: colors[(metadata >>> 24) & 0xff] });
  }
  return result;
}

/** Small deterministic random generator (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['source', 'meta', 'keyword', 'control', 'string', 'quoted', 'entity', 'name', 'function', 'ts', 'py', 'tag', 'block'];
const STYLES = ['', 'italic', 'bold', 'underline', 'strikethrough', 'bold italic', 'italic underline', 'normal'];

test('the same styles as vscode-textmate on 40 random themes and 1,200 scope paths', async () => {
  const next = random(20261121);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const scope = () => Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(NAMES)).join('.');
  const color = () => next() < 0.1 ? pick(['', 'red', '#12', '#GG0000']) : '#' + Math.floor(next() * 0xffffff).toString(16).padStart(6, '0');
  const selector = () => {
    const parts = Array.from({ length: 1 + Math.floor(next() * 3) }, scope);
    return parts.flatMap((part, i) => (i > 0 && next() < 0.2 ? ['>', part] : [part])).join(' ');
  };

  for (let t = 0; t < 40; t++) {
    const rules: RawRule[] = [{ settings: { foreground: color(), background: color() } }];
    for (let r = 0; r < 25; r++) {
      const settings: NonNullable<RawRule['settings']> = {};
      if (next() < 0.7) settings.foreground = color();
      if (next() < 0.2) settings.background = color();
      if (next() < 0.4) settings.fontStyle = pick(STYLES);
      const selectors = Array.from({ length: 1 + Math.floor(next() * 2) }, selector);
      rules.push({ scope: next() < 0.3 ? selectors : selectors.join(', '), settings });
    }
    const paths = Array.from({ length: 30 }, () => Array.from({ length: 1 + Math.floor(next() * 4) }, scope));
    const expected = await referenceStyles(rules, paths);
    const theme = new TextMateTheme(rules);
    paths.forEach((path, i) => {
      const style = theme.resolve(path);
      assert.deepEqual({ fontStyle: style.fontStyle, foreground: style.foreground, background: style.background }, expected[i], `theme ${String(t)}, ${path.join(' ')}`);
    });
  }
});
