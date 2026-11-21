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

`src/theme.ts` follows how VS Code loads a color theme: `_loadColorTheme` in [`colorThemeData.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/themes/common/colorThemeData.ts) and `convertSettings` in [`themeCompatibility.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/themes/common/themeCompatibility.ts), as of commit `671d82d2d8` of microsoft/vscode (November 21, 2026). When VS Code changes them, update the code, its comments and `test/theme.test.ts`.

What VS Code does, and the package with it:

- JSON with comments and trailing commas is accepted; any other syntax error refuses the theme.
- An `include` is read first. The theme then replaces its colors and adds its TextMate rules after the included ones. `"default"` removes an included color.
- A color without `#`, or with a length other than 3, 4, 6 or 8 digits, is shown in red (`#FF0000`); an empty string too. A character that is not a hexadecimal digit counts as 0. A value that is not a string is ignored. The package gives a warning for each case.
- A file with a `settings` array uses the old format: its rules without scope set some workbench colors, and the rest of the file is ignored.
- In an extension, a theme without `uiTheme` is dark (`vs-dark`), and a theme without `label` takes its file name.

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
