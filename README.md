# vscode-theme-audit

Accessibility audit for VS Code color themes, for theme authors and their CI: WCAG contrast of the text and the code, and color pairs that must stay distinct with color blindness simulations.

> **Status: in progress, not published on npm yet.** This first version only sets up the package. The reading engine and the checks come next, as described in [issue #100](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/issues/100).

## Where it comes from

The audit was first written for [365 Day & Night](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext), a set of 48 VS Code themes, where it runs before each release and publishes [its report](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/blob/main/docs/AUDIT.md). That version only reads the themes of its own project. This package makes it read any VS Code color theme, the way VS Code does.

The themes of the Visual Studio Marketplace and of [Open VSX](https://open-vsx.org/) use the same format, so the audit also covers the editors that use Open VSX, such as VSCodium, Cursor or Gitpod.

## Planned usage

```sh
npx vscode-theme-audit themes/my-theme-color-theme.json   # one theme file
npx vscode-theme-audit .                                   # every theme of an extension folder
```

Today, only `--help` and `--version` work.

## What it will check

The same measures as the audit of 365 Day & Night:

- **Contrast** ([WCAG 2.2](https://www.w3.org/TR/WCAG22/#contrast-minimum)) of the text and of each syntax color on its backgrounds.
- **Color blindness:** syntax colors and alerts (errors, warnings, Git changes) must stay distinct with protanopia, deuteranopia and tritanopia simulations, with several published models (Machado et al. 2009, Brettel et al. 1997, Viénot et al. 1999), measured with CIEDE2000.

There will be no score, ranking or badge before a pilot with theme authors.

## Colors that a theme leaves out

A theme almost never sets all the workbench colors. For a key it leaves out, VS Code shows its own default, which depends on the theme type and is often derived from other colors of the theme: `inlineChat.background` is `editorWidget.background`, `editorInlayHint.background` is `badge.background` at 10% of its opacity (except in high contrast dark). The audit measures the color that VS Code shows, with the defaults of VS Code 1.147.0 (extracted from its sources by a script), and says where each color comes from:

| Origin | Meaning |
| --- | --- |
| `theme` | The theme sets the key |
| `default` | VS Code shows its own color |
| `derived` | VS Code computes it from other keys, which are listed |
| `none` | VS Code shows no color for this key |

For a theme of any author, a missing key is information, not a failure. The strict mode keeps the rule of 365 Day & Night, where every key that a check uses must be set by the theme. The colors that the extension of the theme contributes (`contributes.colors`) have their defaults too.

The command does not show this yet. From the sources, the engine gives it:

```ts
import { WorkbenchColors, extensionColors, loadTheme, missingKeys } from './src/index.ts';
import { VSCODE_COLORS } from './src/vscode-colors.ts';

const registry = { ...VSCODE_COLORS, ...extensionColors('.').colors };
const colors = new WorkbenchColors(loadTheme('themes/my-theme.json'), 'vs-dark', registry);
colors.get('inlineChat.background');
// For a dark theme that sets neither inlineChat.background nor editorWidget.background:
// { key: 'inlineChat.background', color: '#252526', origin: 'derived', from: ['editorWidget.background'], registered: true }
missingKeys(colors, ['editor.background', 'inlineChat.background'], { strict: true });
// [{ key: 'inlineChat.background', origin: 'derived', color: '#252526', failure: true }]
```

## Limits

- **Measurements and simulations, not people.** No calculation replaces testing with the people concerned.
- **Thresholds are project rules.** WCAG sets the contrast minimums. The color distinction threshold is a practical rule, not a standard.
- **JSON themes only.** TextMate theme files (`.tmTheme`), an older format, are not read yet.
- **Settings of the user are not read.** The audit measures the theme as published, without `workbench.colorCustomizations`, `editor.tokenColorCustomizations` or `editor.semanticTokenColorCustomizations`. The semantic token types and scopes added by extensions other than the built-in JavaScript and TypeScript ones are not read either.
- **Defaults of one version of VS Code.** The defaults change from one version to the next, a few keys at a time. The version used is written in the package (`VSCODE_SOURCE`).
- **Colors of the theme, not choices made in the code of a view.** When a key has no color, some views choose another one in their own code: the terminal, for example, takes the background of the panel when `terminal.background` has none. The audit gives the color of the key.
- **Colors, not rendering.** The audit reads the theme files. It does not look at a rendered window, antialiasing or a display.

## Development

Requires Node.js 22.18 or later, which runs the TypeScript sources directly.

```sh
npm ci
npm run check   # lint, type check, tests, then build to dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
