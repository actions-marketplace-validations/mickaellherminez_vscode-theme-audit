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

## Limits

- **Measurements and simulations, not people.** No calculation replaces testing with the people concerned.
- **Thresholds are project rules.** WCAG sets the contrast minimums. The color distinction threshold is a practical rule, not a standard.
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
