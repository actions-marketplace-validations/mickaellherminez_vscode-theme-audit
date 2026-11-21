# vscode-theme-audit

Accessibility audit for VS Code color themes, for theme authors and their CI: WCAG contrast of the text and the code, and color pairs that must stay distinct with color blindness simulations.

> **Status: in progress, not published on npm yet.** The reading engine, the checks and the command work from the sources. The first release on npm is planned for version 0.1.0.

## Where it comes from

The audit was first written for [365 Day & Night](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext), a set of 48 VS Code themes, where it runs before each release and publishes [its report](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/blob/main/docs/AUDIT.md). That version only reads the themes of its own project. This package makes it read any VS Code color theme, the way VS Code does.

The themes of the Visual Studio Marketplace and of [Open VSX](https://open-vsx.org/) use the same format, so the audit also covers the editors that use Open VSX, such as VSCodium, Cursor or Gitpod.

## Usage

Once published, with `npx vscode-theme-audit`. Until then, from a clone of this repository (Node.js 22.18 or later, then `npm ci`), with `node src/cli.ts`:

```sh
node src/cli.ts path/to/my-theme-color-theme.json   # one theme file
node src/cli.ts path/to/my-extension                 # every theme of an extension folder (its package.json)
node src/cli.ts path/to/my-extension --json > audit.json   # the report as JSON, for CI
node src/cli.ts path/to/my-extension --strict        # the rules of 365 Day & Night
```

Several files and folders can be given at once. A theme file takes its type (light, dark, high contrast) and its name from the extension that declares it, the nearest `package.json` above it. Without one, its type comes from its `type` field (`light`, `dark`, `hc`, `hcLight`), or it is audited as dark, as VS Code shows it, with a warning.

| Option | Effect |
| --- | --- |
| `--json` | Prints the report as JSON instead of text: format 1, described by [`schema/report-v1.schema.json`](schema/report-v1.schema.json), which the package contains. It gives every check, not only the failures |
| `--strict` | Applies the rules of 365 Day & Night (see below) |
| `-h`, `--help` | Shows the help |
| `-v`, `--version` | Shows the version |

The text report lists, for each theme, the warnings, each failed check with its two colors as shown, the value measured and the minimum, each pair of colors that a vision confuses, then a summary of the theme. A last line counts the themes, those with failures and the failures.

| Exit code | Meaning |
| --- | --- |
| `0` | Every check passes |
| `1` | A check fails, or a pair of colors is confused (in strict mode, also a missing color or a variety failure) |
| `2` | A theme cannot be read, a path does not exist, a folder has no themes, or an option is unknown. The other themes are still audited and reported |

Outside strict mode, a color that VS Code does not show, and the styles of WCAG 1.4.1, are information: they never change the exit code.

The JSON format has a version (`format`). New fields can appear in format 1; a field removed or changing meaning gives format 2, with a new schema.

## What it checks

The same measures as the audit of 365 Day & Night, with the same results on its 48 themes:

- **Contrast** ([WCAG 2.2](https://www.w3.org/TR/WCAG22/#contrast-minimum)) of the text and of each syntax color on its backgrounds: the editor and its selections, the terminal, the panels, the widgets. 4.5:1 for text, 7:1 in high contrast themes. In the terminal, the color measured is the one VS Code shows after its minimum contrast of 4.5:1.
- **Styles** ([WCAG 1.4.1](https://www.w3.org/TR/WCAG22/#use-of-color)), for information: comments in italics, invalid code underlined, deprecated code struck through, links underlined, Markdown headings, bold and italics.
- **Color blindness:** syntax colors and alerts (errors, warnings, Git changes, test results, Git graph lines) must stay distinct with protanopia, deuteranopia and tritanopia simulations, with several published models (Machado et al. 2009, Brettel et al. 1997, Viénot et al. 1999), measured with CIEDE2000. Achromatopsia is measured for information.
- **Strict mode:** the rules of 365 Day & Night on top: every color a check uses must be set by the theme, the main text needs 7:1, the styles are required, the terminal is measured without the help of VS Code, some recent keys and semantic rules are required, and the themes of one type in an extension must look different from each other.

The same checks from the sources, without the command:

```ts
import { auditTheme, isFailure, loadTheme } from './src/index.ts';

const audit = auditTheme(loadTheme('themes/my-theme.json'), 'vs-dark');
audit.checks.filter((check) => isFailure(check));             // checks under their minimum
audit.distinctions.filter((pair) => pair.status === 'fail'); // colors that color blindness confuses
```

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
- **Default settings of VS Code.** The terminal is measured with its default minimum contrast (`terminal.integrated.minimumContrastRatio`: 4.5), and the selected text of the terminal without the adjustments of xterm.js.
- **Settings of the user are not read.** The audit measures the theme as published, without `workbench.colorCustomizations`, `editor.tokenColorCustomizations` or `editor.semanticTokenColorCustomizations`. The semantic token types and scopes added by extensions other than the built-in JavaScript and TypeScript ones are not read either.
- **Defaults of one version of VS Code.** The defaults change from one version to the next, a few keys at a time. The version used is written in the package (`VSCODE_SOURCE`).
- **Colors of the theme, not choices made in the code of a view.** When a key has no color, some views choose another one in their own code: the terminal, for example, takes the background of the panel when `terminal.background` has none. The audit gives the color of the key.
- **Colors, not rendering.** The audit reads the theme files. It does not look at a rendered window, antialiasing or a display.

## Development

Requires Node.js 22.18 or later, which runs the TypeScript sources directly.

```sh
npm ci
npm run check         # lint, type check, tests, then build to dist/
npm run test:corpus   # the 178 themes of 20 Open VSX extensions, downloaded once
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
