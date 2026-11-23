# vscode-theme-audit

[![npm version](https://img.shields.io/npm/v/vscode-theme-audit)](https://www.npmjs.com/package/vscode-theme-audit)

Accessibility audit for VS Code color themes, for theme authors and their CI: WCAG contrast of the text and the code, and color pairs that must stay distinct with color blindness simulations.

> **Status: first releases (0.1).** Planned next: auditing a `.vsix` file or an Open VSX id, a configuration file, and a GitHub Action ([milestones](https://github.com/mickaellherminez/vscode-theme-audit/milestones)).

## Where it comes from

The audit was first written for [365 Day & Night](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext), a set of 48 VS Code themes, where it runs before each release and publishes [its report](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/blob/main/docs/AUDIT.md). That version only reads the themes of its own project. This package makes it read any VS Code color theme, the way VS Code does.

The themes of the Visual Studio Marketplace and of [Open VSX](https://open-vsx.org/) use the same format, so the audit also covers the editors that use Open VSX, such as VSCodium, Cursor or Gitpod.

## Quick start

Node.js 22.18 or later. From the folder of your theme extension (the one with its `package.json`):

```sh
npx vscode-theme-audit .
```

The command reads every theme that the `package.json` declares (`contributes.themes`), measures it as VS Code shows it, prints a report, and exits with `0` when every check passes, `1` when one fails.

## Ways to run it

| How | Command | When |
| --- | --- | --- |
| Without installing | `npx vscode-theme-audit <paths>` | Once, or now and then. npx downloads the package into its cache on the first run |
| Global install | `npm install --global vscode-theme-audit`, then `vscode-theme-audit <paths>` | On your computer, for several projects |
| Project dependency | `npm install --save-dev vscode-theme-audit`, then `npx vscode-theme-audit <paths>` or a script of `package.json` | In a theme project and its CI: the version is fixed in `package-lock.json` |
| TypeScript or JavaScript API | `import { auditPaths } from 'vscode-theme-audit'` | In your own scripts (see [API](#api)) |

As a script of your `package.json`, after `npm install --save-dev vscode-theme-audit`:

```json
{
  "scripts": {
    "audit:themes": "vscode-theme-audit ."
  }
}
```

Then `npm run audit:themes`.

### From the sources

To run the development version, from a clone of this repository:

```sh
git clone https://github.com/mickaellherminez/vscode-theme-audit.git
cd vscode-theme-audit
npm ci
node src/cli.ts path/to/my-extension
```

## Usage

```sh
vscode-theme-audit path/to/my-extension                   # every theme of an extension folder (its package.json)
vscode-theme-audit path/to/themes/my-color-theme.json     # one theme file
vscode-theme-audit ext-one ext-two/themes/night.json      # several paths at once
vscode-theme-audit path/to/my-extension --json > audit.json   # the report as JSON, for CI
vscode-theme-audit path/to/my-extension --strict          # the rules of 365 Day & Night
```

A path is a theme file or an extension folder. A folder must contain a `package.json` that declares its themes; the command does not search subfolders. A theme file takes its type (light, dark, high contrast) and its name from the extension that declares it, the nearest `package.json` above it. Without one, its type comes from its `type` field (`light`, `dark`, `hc`, `hcLight`), or it is audited as dark, as VS Code shows it, with a warning.

| Option | Effect |
| --- | --- |
| `--json` | Prints the report as JSON instead of text: format 1, described by [`schema/report-v1.schema.json`](schema/report-v1.schema.json), which the package contains. It gives every check, not only the failures. See [The JSON report](#the-json-report) |
| `--strict` | Applies the rules of 365 Day & Night (see [Strict mode](#strict-mode)) |
| `-h`, `--help` | Shows the help |
| `-v`, `--version` | Shows the version |

| Exit code | Meaning |
| --- | --- |
| `0` | Every check passes |
| `1` | A check fails, or a pair of colors is confused (in strict mode, also a missing color or a variety failure) |
| `2` | A theme cannot be read, a path does not exist, a folder has no themes, or an option is unknown. The other themes are still audited and reported |

Outside strict mode, a color that VS Code does not show, and the styles of WCAG 1.4.1, are information: they never change the exit code. The errors of exit code `2` (path missing, folder without themes, unknown option) go to the standard error, and then no JSON is printed.

## Reading the report

The text report starts with the version of the package and of VS Code whose colors it uses. Then, for each theme, its name, its type and its file, followed by one line per problem. This is an excerpt of the report of a test theme of this repository (`test/data/oracle-extension/themes/dark.json`), which sets few colors:

```text
vscode-theme-audit 0.1.1, colors of VS Code 1.147.0

Oracle Dark (vs-dark): test/data/oracle-extension/themes/dark.json
  FAIL     Line numbers: #858585 on #1B2230  4.32 < 4.5
  FAIL     activityBarBadge.foreground / activityBarBadge.background: #FFFFFF on #8FBCBB  2.08 < 4.5
  FAIL     Git graph: line 3: #994F00 on #151B26  2.85 < 3
  CONFUSED keyword / function (#D8DEE9 / #D8DEE9): ΔE2000 under 7: normal 0.0, protan 0.0 (Machado 2009), deutan 0.0 (Machado 2009), tritan 0.0 (Brettel 1997)
  247 of 263 checks pass; 64 of 148 pairs stay distinct; 8 colors that VS Code does not show (information); 7 styles of WCAG 1.4.1 missing (information); achromatopsia: 21 of 21 pairs under 7 (information)

1 theme: 1 with failures, 100 failures
```

| Line | Meaning |
| --- | --- |
| `warning: ...` | Something VS Code accepts, but that the author probably did not mean: an invalid color that VS Code shows in red, a value that is not a color, a file name whose case differs. A warning is not a failure |
| `FAIL     <check>: <text> on <background>  <ratio> < <minimum>` | A contrast under its minimum. The two colors are those that VS Code shows: opaque, after a transparent color is composed on what is under it. For a style of WCAG 1.4.1, `expected <style>` |
| `CONFUSED <a> / <b> (<colors>): ΔE2000 under 7: ...` | Two colors that must stay distinct are too close in at least one vision. Each vision gives its smallest difference and the model that gives it |
| `MISSING  <check>` | Strict mode only: a color that the check needs is not set by the theme |
| `ERROR    <reason>` | The theme cannot be read; VS Code would refuse it too |
| The summary line | Checks that pass, pairs that stay distinct (each pair counted once in each of the 4 visions), then information: colors that VS Code does not show, styles of WCAG 1.4.1, achromatopsia |
| The last line | Themes audited, themes with failures, failures (failed checks, plus confused pairs counted once in each vision where they are confused), and themes that cannot be read |

To fix a failure, change the color named in the line: a check named `foreground key / background key` names both keys of the theme. A check with a plain label, such as `Line numbers`, is listed with its keys in [the list of checks](docs/checks.md).

## The JSON report

`--json` prints the same audit as one JSON document, with every check, passed or not, and every pair in every vision. Its main fields, for the same test theme, with each list cut to one entry that fails:

```jsonc
{
  "format": 1,                                   // the version of this format
  "tool": { "name": "vscode-theme-audit", "version": "0.1.1" },
  "vscode": { "version": "1.147.0", "commit": "8a14f0cc1b08d531eb83255ea3764ae22aa932b5" },
  "strict": false,
  "minimumDeltaE2000": 7,
  "warnings": [],                                // about the extensions: their package.json and colors
  "themes": [{
    "label": "Oracle Dark", "file": "test/data/oracle-extension/themes/dark.json", "uiTheme": "vs-dark", "warnings": [],
    "summary": { "checks": 263, "failed": 16, "missing": 8, "information": 7, "pairs": 148, "confused": 84 },
    "checks": [
      { "label": "Line numbers", "value": 4.317608886674965, "minimum": 4.5, "status": "fail", "colors": ["#858585", "#1B2230"] }
    ],
    "distinctions": [
      { "view": "deutan", "pair": ["keyword", "function"], "deltaE2000": 0, "model": "Machado 2009", "cie76": 0, "colors": ["#D8DEE9", "#D8DEE9"], "status": "fail" }
    ],
    "achromatopsia": [{ "pair": ["keyword", "function"], "deltaE2000": 0, "cie76": 0, "colors": ["#D8DEE9", "#D8DEE9"] }]
  }],
  "variety": [],                                 // strict mode: the themes of one type compared with each other
  "summary": { "themes": 1, "themesWithFailures": 1, "failures": 100, "unreadable": 0 }
}
```

A check fails when its `status` is `"fail"` and it has no `"information": true`, or, in strict mode, when its `status` is `"missing"`. The values are not rounded. Every field is described in [docs/report-format.md](docs/report-format.md), and the schema [`schema/report-v1.schema.json`](schema/report-v1.schema.json) (JSON Schema 2020-12) can validate a report. New fields can appear in format 1; a field removed or changing meaning gives format 2, with a new schema.

## In a CI

A GitHub Actions job that audits the themes of the repository on each push and pull request, and keeps the JSON report as an artifact:

```yaml
name: Theme audit
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npx --yes vscode-theme-audit@0.1.1 .
      - run: npx --yes vscode-theme-audit@0.1.1 . --json > theme-audit.json
        if: always()
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: theme-audit
          path: theme-audit.json
```

The first step fails the job when a check fails (exit code `1`) or a theme cannot be read (`2`). Give a fixed version (`@0.1.1`), so that a new release of the package, with new checks or the colors of a newer VS Code, does not change the result of a commit. With the package in `devDependencies`, `npm ci` then `npx vscode-theme-audit .` uses the version of `package-lock.json`.

## What it checks

The same measures as the audit of 365 Day & Night, with the same results on its 48 themes:

| Check | What it measures | Minimum |
| --- | --- | --- |
| Contrast | The WCAG 2.2 contrast ratio of each text color on its background: the editor and its selections, line numbers, find matches, the terminal and its ANSI colors, the debug console, the side bar, lists, tabs, the status bar, buttons, inputs, widgets, notifications, menus, Git decorations, chat, testing, notebooks, merge editor, symbol icons, Git graph, command center, agent sessions, each syntax category and each semantic color | 4.5:1 for text (WCAG AA), 3:1 for indicators, borders and icons; 7:1 for text in high contrast themes (AAA). Lower minimums for a selection or the current line to stay visible (1.2 to 1.35; 2 or 3 in high contrast) |
| Color blindness | The CIEDE2000 difference between colors that must stay distinct: keyword, function, string, number, class, comment and variable; error, warning and info; added, modified and deleted; passed and failed tests; the 5 lines of the Git graph. In normal vision, and with protanopia, deuteranopia and tritanopia simulations by several models: the closest one counts | ΔE2000 of 7, a project rule |
| Styles (WCAG 1.4.1) | Comments in italics, invalid code underlined, deprecated code struck through, links underlined, Markdown headings and bold in bold, Markdown italics in italics | Information (a failure in strict mode) |
| Achromatopsia | The same difference between the syntax colors, seen without color | Information |

The colors measured are those that VS Code 1.147.0 shows: the theme, then the defaults of VS Code for the colors that the theme leaves out (see [Colors that a theme leaves out](#colors-that-a-theme-leaves-out)). In the terminal, the color measured is the one VS Code shows after its minimum contrast of 4.5:1. The semantic colors are checked when the theme enables semantic highlighting, since VS Code shows them only then.

Each check, its keys, its minimum and its references are listed in [docs/checks.md](docs/checks.md). The references:

- **Contrast:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/), success criteria [1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum), [1.4.6 Contrast (Enhanced)](https://www.w3.org/TR/WCAG22/#contrast-enhanced), [1.4.11 Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast) and [1.4.1 Use of Color](https://www.w3.org/TR/WCAG22/#use-of-color), with the relative luminance and contrast ratio of WCAG.
- **Color difference:** CIEDE2000, as specified in CIE 15:2004 and checked against the test data of G. Sharma, W. Wu and E. N. Dalal, "The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations", *Color Research & Application* 30(1), 2005.
- **Color blindness simulations:** G. M. Machado, M. M. Oliveira and L. A. F. Fernandes, "A Physiologically-based Model for Simulation of Color Vision Deficiency", *IEEE TVCG* 15(6), 2009; H. Brettel, F. Viénot and J. D. Mollon, "Computerized simulation of color appearance for dichromats", *JOSA A* 14(10), 1997; F. Viénot, H. Brettel and J. D. Mollon, "Digital video colourmaps for checking the legibility of displays by dichromats", *Color Research & Application* 24(4), 1999.

There will be no score, ranking or badge before a pilot with theme authors.

### Strict mode

`--strict` applies the rules of 365 Day & Night, stricter than WCAG AA and meant for that project:

- every color that a check uses must be set by the theme: a missing one is a failure, and the defaults of VS Code do not count;
- the main text (editor, terminal, side bar, notebook cells) needs 7:1, and the terminal is measured with the colors of the theme, without the minimum contrast of VS Code;
- the styles of WCAG 1.4.1 are failures;
- some recent keys and semantic rules must be set, and the status bar button of 365 Day & Night must be readable;
- the themes of one type in an extension must look different from each other (variety).

## Colors that a theme leaves out

A theme almost never sets all the workbench colors. For a key it leaves out, VS Code shows its own default, which depends on the theme type and is often derived from other colors of the theme: `inlineChat.background` is `editorWidget.background`, `editorInlayHint.background` is `badge.background` at 10% of its opacity (except in high contrast dark). The audit measures the color that VS Code shows, with the defaults of VS Code 1.147.0 (extracted from its sources by a script), and says where each color comes from:

| Origin | Meaning |
| --- | --- |
| `theme` | The theme sets the key |
| `default` | VS Code shows its own color |
| `derived` | VS Code computes it from other keys, which are listed |
| `none` | VS Code shows no color for this key |

For a theme of any author, a missing key is information, not a failure. The strict mode keeps the rule of 365 Day & Night, where every key that a check uses must be set by the theme. The colors that the extension of the theme contributes (`contributes.colors`) have their defaults too.

The command does not show the origin yet; the API gives it (see below).

## API

The package exports its engine, with its TypeScript types. The main functions:

```ts
import { auditPaths, auditTheme, exitCode, isFailure, loadTheme, packageVersion, textReport } from 'vscode-theme-audit';

// What the command does: a report in the JSON format, the text report and the exit code
const report = auditPaths(['path/to/my-extension'], { version: packageVersion(), strict: false });
console.log(textReport(report));
process.exitCode = exitCode(report);

// One theme, with its type: 'vs' (light), 'vs-dark', 'hc-black' or 'hc-light'
const audit = auditTheme(loadTheme('themes/my-theme.json'), 'vs-dark');
audit.checks.filter((check) => isFailure(check));             // checks under their minimum
audit.distinctions.filter((pair) => pair.status === 'fail'); // colors that a vision confuses
```

The origin of each workbench color:

```ts
import { VSCODE_COLORS, WorkbenchColors, extensionColors, loadTheme, missingKeys } from 'vscode-theme-audit';

const registry = { ...VSCODE_COLORS, ...extensionColors('.').colors };
const colors = new WorkbenchColors(loadTheme('themes/my-theme.json'), 'vs-dark', registry);
colors.get('inlineChat.background');
// For a dark theme that sets neither inlineChat.background nor editorWidget.background:
// { key: 'inlineChat.background', color: '#252526', origin: 'derived', from: ['editorWidget.background'], registered: true }
missingKeys(colors, ['editor.background', 'inlineChat.background'], { strict: true });
// [{ key: 'inlineChat.background', origin: 'derived', color: '#252526', failure: true }]
```

Before version 1.0.0, the API can change in any release, as [Semantic Versioning](https://semver.org/spec/v2.0.0.html#spec-item-4) allows; the CHANGELOG lists each change. Version 1.0.0 will fix the public API. The command and the JSON format follow their own rules above.

## Limits

- **Measurements and simulations, not people.** No calculation replaces testing with the people concerned. The color blindness simulations are models of dichromacy, which disagree with each other and approximate the vision of each person; that is why a pair must stay distinct with all of them.
- **Thresholds are project rules.** WCAG sets the contrast minimums. The color distinction threshold (ΔE2000 of 7) and the minimums for selections are practical rules, not standards.
- **JSON themes only.** TextMate theme files (`.tmTheme`), an older format, are not read yet. Product icon and file icon themes are not color themes and are not read.
- **Default settings of VS Code.** The terminal is measured with its default minimum contrast (`terminal.integrated.minimumContrastRatio`: 4.5), and the selected text of the terminal without the adjustments of xterm.js.
- **Settings of the user are not read.** The audit measures the theme as published, without `workbench.colorCustomizations`, `editor.tokenColorCustomizations` or `editor.semanticTokenColorCustomizations`. The semantic token types and scopes added by extensions other than the built-in JavaScript and TypeScript ones are not read either.
- **Defaults of one version of VS Code.** The defaults change from one version to the next, a few keys at a time. The version used is written in the report (`vscode`) and in the package (`VSCODE_SOURCE`).
- **Colors of the theme, not choices made in the code of a view.** When a key has no color, some views choose another one in their own code: the terminal, for example, takes the background of the panel when `terminal.background` has none. The audit gives the color of the key, except for the terminal and the notebook cells, whose replacement it follows.
- **Colors, not rendering.** The audit reads the theme files. It does not look at a rendered window, antialiasing or a display. Its token colors were checked against the editor of VS Code itself on five themes (see [CONTRIBUTING](CONTRIBUTING.md#checked-in-the-editor-of-vs-code)).

## Uninstall

| Installed with | Remove with |
| --- | --- |
| `npx vscode-theme-audit` | Nothing is installed. npx keeps a copy in its cache, `~/.npm/_npx/` (`%LocalAppData%\npm-cache\_npx\` on Windows), which `npm cache clean --force` empties with the rest of the npm cache. To remove only this package, delete the folder of `~/.npm/_npx/` whose `package.json` names `vscode-theme-audit` |
| `npm install --global vscode-theme-audit` | `npm uninstall --global vscode-theme-audit` |
| `npm install --save-dev vscode-theme-audit` | `npm uninstall vscode-theme-audit`, which also removes it from `package.json` and `package-lock.json`. Remove the scripts of `package.json` that call it |
| From the sources | Delete the clone |

To remove it from a CI, delete the steps that run it (or the whole workflow file, such as `.github/workflows/theme-audit.yml` in the example above), and the artifact step if you kept the JSON report. Nothing else is left: the command writes nothing on disk except the report you redirect, and it sends nothing over the network.

## Development

Requires Node.js 22.18 or later, which runs the TypeScript sources directly.

```sh
npm ci
npm run check         # lint, type check, tests, then build to dist/
npm run test:corpus   # the 178 themes of 20 Open VSX extensions, downloaded once
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Parts ported from Visual Studio Code, vscode-textmate and xterm.js keep their MIT notices: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
