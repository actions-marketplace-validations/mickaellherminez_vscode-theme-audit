// The checks on cases that the themes of 365 Day & Night do not show: failures, missing colors, the colors that
// VS Code shows for any theme, and the variety between themes.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { auditTheme, auditVariety, hueFamily, isFailure, terminalColor, tokenColors, varietyFailures } from '../src/audit.ts';
import type { Check, ThemeAudit } from '../src/audit.ts';
import { contrast, over } from '../src/color.ts';
import type { TextMateRule, Theme, UiTheme } from '../src/theme.ts';

function theme(colors: Record<string, string> = {}, tokenColors: TextMateRule[] = [], semantic: Record<string, unknown> = {}, semanticHighlighting = false): Theme {
  return {
    files: [], colors, tokenColors, semanticHighlighting, warnings: [],
    semanticTokenColors: Object.entries(semantic).map(([selector, style]) => ({ selector, style, file: '' })),
  };
}

function check(audit: ThemeAudit, label: string): Check {
  const found = audit.checks.find((c) => c.label === label);
  assert.ok(found, `no check "${label}"`);
  return found;
}

const DARK = { 'editor.background': '#1E1E2E', 'editor.foreground': '#CDD6F4' };

describe('the colors that the checks read', () => {
  test('by default, those that VS Code shows, its defaults included', () => {
    const audit = auditTheme(theme(), 'vs-dark');
    const text = check(audit, 'Editor: text / background');
    assert.equal(text.value, contrast('#BBBBBB', '#1E1E1E'));
    assert.equal(text.status, 'pass');
  });

  test('in strict mode, only those that the theme sets', () => {
    assert.deepEqual(auditTheme(theme(), 'vs-dark', { strict: true }).checks, [{ label: 'editor.background', value: null, minimum: 0, status: 'missing' }]);
    const audit = auditTheme(theme({ 'editor.background': '#1E1E2E' }), 'vs-dark', { strict: true });
    assert.equal(check(audit, 'Editor: text / background').status, 'missing');
  });

  test('a color that VS Code does not show is missing: information by default, a failure in strict mode', () => {
    const missing = check(auditTheme(theme(DARK), 'vs-dark'), 'Find: border of the current match');
    assert.deepEqual(missing, { label: 'Find: border of the current match', value: null, minimum: 3, status: 'missing' });
    assert.equal(isFailure(missing), false);
    assert.equal(isFailure(missing, true), true);
  });

  test('the terminal takes the background of the panel when it has none, as in VS Code', () => {
    const audit = auditTheme(theme({ ...DARK, 'panel.background': '#11111B' }), 'vs-dark');
    assert.equal(check(audit, 'Terminal: text / background').value, contrast('#CCCCCC', '#11111B'));
  });

  test('a transparent color is composed on its background', () => {
    const audit = auditTheme(theme({ ...DARK, 'editor.selectionBackground': '#CDD6F440' }), 'vs-dark');
    const selection = over('#CDD6F440', '#1E1E2E');
    assert.equal(check(audit, 'Editor: selection visible on the background').value, contrast(selection, '#1E1E2E'));
    assert.equal(check(audit, 'Editor: selected text').value, contrast('#CDD6F4', selection));
  });
});

describe('contrast', () => {
  test('the main text needs 4.5:1 (WCAG AA), 7:1 in high contrast and in strict mode', () => {
    const minimum = (uiTheme: UiTheme, strict = false) => check(auditTheme(theme(DARK), uiTheme, { strict }), 'Editor: text / background').minimum;
    assert.deepEqual([minimum('vs-dark'), minimum('vs'), minimum('hc-black'), minimum('hc-light'), minimum('vs-dark', true)], [4.5, 4.5, 7, 7, 7]);
    assert.equal(check(auditTheme(theme(DARK), 'vs-dark'), 'sideBar.foreground / sideBar.background').minimum, 4.5);
  });

  test('a pair under its minimum fails', () => {
    const audit = auditTheme(theme({ ...DARK, 'editorLineNumber.foreground': '#45475A' }), 'vs-dark');
    const numbers = check(audit, 'Line numbers');
    assert.equal(numbers.status, 'fail');
    assert.equal(numbers.minimum, 4.5);
    assert.equal(isFailure(numbers), true);
  });

  test('in high contrast, text needs 7:1, except the selected text of the debug console', () => {
    const audit = auditTheme(theme({ 'editor.background': '#000000', 'editor.foreground': '#FFFFFF' }), 'hc-black');
    assert.equal(check(audit, 'Line numbers').minimum, 7);
    assert.equal(check(audit, 'Debug console: infoForeground selected').minimum, 4.5);
  });
});

describe('the terminal', () => {
  test('VS Code changes the color of the text until it reaches 4.5:1, as xterm.js does', () => {
    // Expected colors computed by rgba.ensureContrastRatio of xterm.js 6.1.0-beta.337 itself
    const cases = [
      ['#0451A5', '#FFFFFF', '#0451A5'], ['#2472C8', '#1E1E1E', '#4E8ED3'], ['#666666', '#1E1E1E', '#919191'],
      ['#000000', '#1E1E1E', '#878787'], ['#E5E510', '#FFFFFF', '#787807'], ['#808080', '#7F7F7F', '#161616'],
      ['#CCCCCC', '#11111B', '#CCCCCC'], ['#BC3FBC', '#252526', '#C965C9'],
    ];
    for (const [foreground, background, shown] of cases) assert.equal(terminalColor(foreground ?? '', background ?? ''), shown, `${String(foreground)} on ${String(background)}`);
  });

  test('the checks measure the color shown, except in strict mode', () => {
    const colors = { ...DARK, 'terminal.background': '#1E1E1E', 'terminal.ansiBlue': '#2472C8' };
    const shown = check(auditTheme(theme(colors), 'vs-dark'), 'Terminal ANSI Blue');
    assert.equal(shown.value, contrast('#4E8ED3', '#1E1E1E'));
    assert.equal(shown.status, 'pass');
    const strict = check(auditTheme(theme(colors), 'vs-dark', { strict: true }), 'Terminal ANSI Blue');
    assert.equal(strict.value, contrast('#2472C8', '#1E1E1E'));
    assert.equal(strict.status, 'fail');
  });

  test('in high contrast, 4.5:1 is not enough for the text', () => {
    const colors = { 'editor.background': '#000000', 'editor.foreground': '#FFFFFF', 'terminal.background': '#000000', 'terminal.ansiBlue': '#0000EE' };
    const blue = check(auditTheme(theme(colors), 'hc-black'), 'Terminal ANSI Blue');
    assert.equal(blue.minimum, 7);
    assert.equal(blue.status, 'fail');
    assert.ok(blue.value !== null && blue.value >= 4.5);
  });
});

describe('syntax colors', () => {
  const rules: TextMateRule[] = [
    { scope: 'keyword', settings: { foreground: '#CBA6F7' } },
    { scope: 'entity.name.function', settings: { foreground: '#CBA6F7' } },
    { scope: 'comment', settings: { foreground: '#7F849C', fontStyle: 'italic' } },
  ];

  test('in strict mode, a category that no rule colors has no color, except variables', () => {
    const strict = tokenColors(theme(DARK, rules), 'vs-dark', true);
    // A rule for `keyword` also colors `keyword.operator`, as in VS Code
    assert.deepEqual([...strict.keys()], ['comment', 'keyword', 'function', 'operator', 'variable']);
    assert.equal(strict.get('variable'), '#CDD6F4');
    // By default, the color that VS Code shows: the editor color for a category without a rule
    assert.equal(tokenColors(theme(DARK, rules), 'vs-dark').get('string'), '#CDD6F4');
  });

  test('two categories with the same color are confused in every vision', () => {
    const audit = auditTheme(theme(DARK, rules), 'vs-dark');
    const confused = audit.distinctions.filter((d) => d.pair.includes('keyword') && d.pair.includes('function'));
    assert.deepEqual(confused.map((d) => [d.view, d.deltaE2000, d.status]), [
      ['normal', 0, 'fail'], ['protan', 0, 'fail'], ['deutan', 0, 'fail'], ['tritan', 0, 'fail'],
    ]);
    assert.equal(confused[1]?.model, 'Machado 2009');
  });

  test('WCAG 1.4.1: the styles that carry a meaning, information by default and required in strict mode', () => {
    const audit = auditTheme(theme(DARK, rules), 'vs-dark');
    assert.equal(check(audit, 'Style (WCAG 1.4.1): comment in italic').status, 'pass');
    const link = check(audit, 'Style (WCAG 1.4.1): link underlined');
    assert.deepEqual(link, { label: 'Style (WCAG 1.4.1): link underlined', value: null, minimum: 'underline', status: 'fail', information: true });
    assert.equal(isFailure(link), false);
    const strict = check(auditTheme(theme(DARK, rules), 'vs-dark', { strict: true }), 'Style (WCAG 1.4.1): link underlined');
    assert.deepEqual(strict, { label: 'Style (WCAG 1.4.1): link underlined', value: null, minimum: 'underline', status: 'fail' });
    assert.equal(isFailure(strict, true), true);
  });

  test('achromatopsia is measured for information', () => {
    const audit = auditTheme(theme(DARK, rules), 'vs-dark');
    assert.ok(audit.achromatopsia.length > 0);
    assert.ok(audit.achromatopsia.every((p) => !('status' in p)));
  });
});

describe('semantic tokens', () => {
  const semantic = { 'variable.readonly': '#FAB387', '*.deprecated': { strikethrough: true } };

  test('checked when the theme enables them', () => {
    const off = auditTheme(theme(DARK, [], semantic), 'vs-dark');
    assert.equal(off.checks.some((c) => c.label.startsWith('Semantic: ') || c.label.includes('semantic')), false);
    const on = auditTheme(theme(DARK, [], semantic, true), 'vs-dark');
    assert.equal(check(on, 'Semantic: variable.readonly').status, 'pass');
    assert.equal(check(on, 'Style (WCAG 1.4.1): deprecated semantic token struck through').status, 'pass');
  });

  test('in strict mode, the semantic roles of 365 Day & Night are required', () => {
    const audit = auditTheme(theme(DARK, [], semantic), 'vs-dark', { strict: true });
    assert.equal(check(audit, 'Semantic: variable.readonly').status, 'pass');
    assert.equal(check(audit, 'Semantic: parameter').status, 'missing');
  });
});

describe('the rules of 365 Day & Night, in strict mode only', () => {
  test('required keys and the status bar button', () => {
    const colors = { ...DARK, 'statusBar.background': '#181825', 'statusBar.foreground': '#CDD6F4', '365DayNight.statusBarButton': '#F9E2AF' };
    const strict = auditTheme(theme(colors), 'vs-dark', { strict: true });
    assert.equal(check(strict, 'Required key: chat.slashCommandBackground').status, 'missing');
    assert.equal(check(strict, 'Status bar button / status bar').status, 'pass');
    assert.equal(check(strict, 'Status bar button distinct from the status bar text').status, 'pass');
    const general = auditTheme(theme(colors), 'vs-dark');
    assert.equal(general.checks.some((c) => c.label.startsWith('Required key') || c.label.startsWith('Status bar button')), false);
  });
});

describe('variety between the themes of an extension', () => {
  const named = (name: string, uiTheme: UiTheme, colors: Record<string, string>) => ({ name, uiTheme, theme: theme(colors, [
    { scope: 'keyword', settings: { foreground: '#CBA6F7' } }, { scope: 'entity.name.function', settings: { foreground: '#89B4FA' } },
    { scope: 'string', settings: { foreground: '#A6E3A1' } }, { scope: 'constant.numeric', settings: { foreground: '#FAB387' } },
    { scope: 'entity.name.class', settings: { foreground: '#F9E2AF' } }, { scope: 'comment', settings: { foreground: '#7F849C' } },
  ]) });
  const surfaces = (background: string) => ({ 'editor.background': background, 'sideBar.background': background, 'statusBar.background': background, 'activityBarBadge.background': background });

  test('themes that look the same fail, and at most 3 themes may share a hue family', () => {
    const themes = ['#1E3A5F', '#1F3B60', '#203C61', '#213D62'].map((c, i) => named(`blue ${String(i + 1)}`, 'vs-dark', surfaces(c)));
    const varieties = auditVariety([...themes, named('light', 'vs', surfaces('#FFFFFF'))]);
    assert.deepEqual(varieties.map((v) => [v.uiTheme, v.themes.length]), [['vs', 1], ['vs-dark', 4]]);
    const variety = varieties[1];
    assert.ok(variety);
    assert.deepEqual(variety.measures.map((m) => [m.measure, m.threshold]), [
      ['editor.background', 8], ['sideBar.background', 7], ['statusBar.background', null], ['activityBarBadge.background', 25], ['syntax', 18],
    ]);
    assert.equal(variety.measures[0]?.pairs.length, 6);
    const failures = varietyFailures(variety);
    assert.ok(failures.includes('editor.background: 4 themes in the blue family'));
    assert.ok(failures.some((f) => f.startsWith('syntax: blue 1 / blue 2 0.0 < 18')));
    assert.equal(failures.some((f) => f.startsWith('statusBar.background')), false);
  });

  test('a theme without a color that a measure needs is listed, and the measure left out', () => {
    const [variety] = auditVariety([named('a', 'vs-dark', surfaces('#1E3A5F')), named('b', 'vs-dark', { 'editor.background': '#5F1E3A' })]);
    assert.deepEqual(variety?.missing, ['b']);
    assert.deepEqual(variety.measures.map((m) => m.measure), ['editor.background', 'syntax']);
  });

  test('hue families: 8 sectors of 45° of the CIELAB hue, or neutral', () => {
    assert.deepEqual(['#808080', '#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#1E3A5F', '#0000FF'].map(hueFamily),
      ['neutral', 'red-orange', 'yellow', 'green', 'blue-green', 'blue', 'violet']);
  });
});
