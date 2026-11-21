# Contributing

## Setup

Node.js 22.18 or later runs the TypeScript files directly, by removing the types: no build is needed to run the tests or the command. Only syntax that can be removed this way is allowed (no `enum`, no `namespace`), and imports between source files use the `.ts` extension. The build rewrites them to `.js`.

```sh
npm ci
node src/cli.ts --help   # run the command from the sources
```

## Measuring tools

`src/color.ts`, `src/simulation.ts` and `src/difference.ts` are ported from [`colorlib.py`](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/blob/main/scripts/themes/colorlib.py) of 365 Day & Night, and must give the same results. Where Python rounds, they round like Python: a value exactly halfway goes to the even neighbor (`roundHalfEven`).

`test/color.test.ts` checks them against published data, and `test/python-parity.test.ts` against the results of `colorlib.py`. The data and their sources are described in [test/data/README.md](test/data/README.md). After a change of `colorlib.py`, rebuild its reference file from a clone of 365 Day & Night:

```sh
python3 -I test/data/colorlib_reference.py ../365-daynight-vscode-theme-ext > test/data/colorlib-reference.json
```

## Reading a theme

`src/theme.ts` follows how VS Code loads a color theme: `_loadColorTheme` in [`colorThemeData.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/themes/common/colorThemeData.ts) and `convertSettings` in [`themeCompatibility.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/themes/common/themeCompatibility.ts), as of VS Code 1.147.0 (commit `8a14f0cc1b`, November 18, 2026). When VS Code changes them, update the code, its comments and `test/theme.test.ts`.

What VS Code does, and the package with it:

- JSON with comments and trailing commas is accepted; any other syntax error refuses the theme.
- An `include` is read first. The theme then replaces its colors and adds its TextMate rules after the included ones. `"default"` removes an included color.
- A color without `#`, or with a length other than 3, 4, 6 or 8 digits, is shown in red (`#FF0000`); an empty string too. A character that is not a hexadecimal digit counts as 0. A value that is not a string is ignored. The package gives a warning for each case.
- A file with a `settings` array uses the old format: its rules without scope set some workbench colors, and the rest of the file is ignored.
- In an extension, a theme without `uiTheme` is dark (`vs-dark`), and a theme without `label` takes its file name.

## Token colors

VS Code does not choose the color of a token itself: it gives the TextMate rules of the theme to [vscode-textmate](https://github.com/microsoft/vscode-textmate), which colors the code. `src/textmate.ts` ports how vscode-textmate matches a scope (`src/theme.ts`, commit `98cc6331dc`), with its tests in `test/textmate.test.ts`. `src/tokens.ts` adds what VS Code does before (`tokenColors` in `colorThemeData.ts`): a first rule with the editor colors, or their defaults; rules without scope left out; colors written in full and in uppercase; colors for log files when the theme sets none.

`test/textmate-oracle.test.ts` compares the port with vscode-textmate itself, a development dependency, on themes and scope paths generated at random with a fixed seed. vscode-textmate does not export its theme: a grammar with one pattern gives each scope path to its tokenizer, and the style is read back from the token metadata. If you change `src/textmate.ts`, this test must still pass.

## Semantic tokens

In many languages, a language server classifies names (a read-only `variable`, a `parameter`...) and VS Code styles them over the TextMate colors, when the theme sets `"semanticHighlighting": true`. `src/semantic.ts` ports how VS Code finds that style (`getTokenStyle` in `colorThemeData.ts`, `tokenClassificationRegistry.ts`):

1. Each rule of `semanticTokenColors` that matches the token gets a score: 100 for its type (minus 1 per super type level), 100 per modifier, 10 for a language. For each property (color, bold, italic, underline, strikethrough), the best score wins, and the last rule wins a tie.
2. For the properties still unset, VS Code probes TextMate scopes, such as `variable.other.constant` for `variable.readonly`, with the scope selectors of `textMateScopeMatcher.ts`. The built-in JavaScript and TypeScript extensions add their own scopes for their languages.
3. A property that is still unset keeps the TextMate style of the token: `withSemantic()` combines both.

`test/semantic.test.ts` starts with the tests of VS Code (`tokenStyleResolving.test.ts`). The `semanticTokenScopes` and token types of other extensions, and the user setting `editor.semanticTokenColorCustomizations`, are not read.

## Default colors

A theme almost never sets all the workbench colors. For a key it leaves out, VS Code shows the default that the key was registered with (`registerColor` in its sources): one value per theme type (light, dark, high contrast dark, high contrast light), which is a color, the id of another color, a transform of other colors (`transparent`, `darken`, `oneOf`...), or nothing. `src/colors.ts` ports how VS Code resolves them: `Color` of `color.ts`, `resolveColorValue` and `executeTransform` of `colorUtils.ts`, `getColor` and `defines` of `colorThemeData.ts`, and the `contributes.colors` of an extension (`colorExtensionPoint.ts`).

The defaults themselves are data, in `src/vscode-colors.ts`, generated by `scripts/vscode-colors.ts` from the sources of a pinned release of VS Code: 1.147.0 (commit `8a14f0cc1b`, November 18, 2026). The other ported files of this package follow the same release. Do not edit this file by hand. To generate it again, from a partial clone of VS Code next to this repository (about 260 MB):

```sh
git init ../vscode && cd ../vscode
git remote add origin https://github.com/microsoft/vscode.git
git sparse-checkout set --no-cone '/src/vs/**/*.ts' '/extensions/*/package.json' '/package.json'
git fetch --depth 1 --filter=blob:none origin tag 1.147.0
git checkout 1.147.0
cd -
node scripts/vscode-colors.ts ../vscode   # writes src/vscode-colors.ts, then prints a summary
```

The script:

- follows the static imports of the desktop workbench from `src/vs/workbench/workbench.desktop.main.ts`, in the order the modules run, and leaves out an import that only brings types, as the TypeScript compiler does. A file that registers colors but that the workbench does not load (today, two files of the Agents window in `src/vs/sessions/`) is listed in the summary;
- evaluates each call of `registerColor` in these modules, including the calls inside `for ... in` and `for ... of` loops (the ANSI colors of the terminal), and the colors written as `Color` objects. It stops with an error, and the line, on any code it cannot evaluate, rather than guess;
- adds the colors that the built-in extensions contribute in their `package.json` (today, the `gitDecoration.*` colors of Git), with the rules of VS Code: the high contrast defaults fall back to the dark and light ones;
- writes the version and the commit of VS Code in `VSCODE_SOURCE`, which the audit can report.

To move to another release of VS Code: check it out, run the script, read the diff of `src/vscode-colors.ts`, update the version in the test `the defaults come from the pinned release of VS Code`, in this file and in the comments of the ported files (after checking that those files did not change), and run `npm run check`. To go back, check out the previous `src/vscode-colors.ts` from git, or run the script again on the previous release.

### Checked against VS Code itself

`scripts/vscode-oracle.ts` records the colors that a real VS Code shows: for every registered color, the workbench writes a CSS variable `--vscode-<id>` with `theme.getColor(id, true)`, the same function. The script starts VS Code with a temporary profile (deleted at the end), loads the given extensions from copies without their code, selects each theme through the settings of that profile, and reads the variables through the remote debugging port of the window.

```sh
# macOS, with VS Code in /Applications; elsewhere, give the executable with --code
node scripts/vscode-oracle.ts --keys test/data/oracle-keys.txt test/data/vscode-oracle.json test/data/oracle-extension
```

The test `the colors that VS Code shows for the test themes` compares the package with this record: four themes of `test/data/oracle-extension`, one per theme type, and the 251 keys of `test/data/oracle-keys.txt`. The record comes from the version of VS Code that ran the script (it is written in the file), so the keys must have the same defaults in that version and in the pinned release: when you record again, check that the test still passes, and remove from the list a key whose default changed between the two. Without `--keys`, the script records every variable, to compare a larger set of themes. On November 21, 2026, the 178 themes of 20 of the most downloaded theme extensions on Open VSX and the 48 themes of 365 Day & Night gave 0 difference with VS Code 1.146.0 on 226,726 colors, with the defaults of that version.

What this does not cover: some views of VS Code choose another color in their own code when a key has no color, such as the terminal, which uses the background of the panel when `terminal.background` has none. The package gives the color of the key, as the theme and the defaults set it.

The code ported from Microsoft keeps its MIT license notice: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Checks

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint, with the strict type-checked rules of typescript-eslint |
| `npm run typecheck` | TypeScript, without writing files |
| `npm test` | The tests of `test/`, with the test runner of Node.js |
| `npm run build` | Compiles `src/` to `dist/`, the only folder published to npm |
| `npm run check` | All of the above, in this order |

The [CI workflow](.github/workflows/ci.yml) runs them on every push and pull request, with Node.js 22 and 24. It also runs the built command and lists the content of the package (`npm pack --dry-run`).

The [CodeQL workflow](.github/workflows/codeql.yml) looks for security problems in the TypeScript code and in the workflows, on every pull request to `main`, on `main` and every Monday. Its results are in the Security tab.

## Pull requests

Each change starts from an issue, and its pull request links to it. Describe what changes, what you checked, and update the [CHANGELOG](CHANGELOG.md).
