# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- The style of a token from its scopes, as VS Code shows it with TextMate grammars: the matching of vscode-textmate (scope prefixes, comma-separated selectors, parent scopes and `>`, the most specific rule wins), ported with its tests, and the rules that VS Code gives it (the editor colors as defaults, colors written in full, log colors). Checked against vscode-textmate itself, on random themes in the tests and on 11,036 styles of the 178 themes of the corpus, with no difference. Semantic tokens come next.
- Reading a color theme the way VS Code does: JSON with comments and trailing commas, `include`, `"default"` to remove an included color, the old `settings` format, `semanticTokenColors`, and the themes of an extension folder with their `uiTheme` and translated labels. Warnings for what VS Code accepts but probably was not meant, such as a color it shows in red. TextMate theme files (`.tmTheme`) are not supported yet.
- The measuring tools, ported from `colorlib.py` of 365 Day & Night with the same results: WCAG 2 contrast, alpha compositing, CIELAB, CIE76 and CIEDE2000, and the color blindness simulations of Machado et al. 2009, Brettel et al. 1997 and Viénot et al. 1999, with the models kept for each deficiency. Tested against published data (Sharma et al. 2005, Machado et al. 2009), DaltonLens, and the results of `colorlib.py`.
- The package and its command, with `--help` and `--version` only. TypeScript run directly by Node.js 22.18 or later, ESLint, tests with the test runner of Node.js, CI on Node.js 22 and 24, and CodeQL ([365-daynight-vscode-theme-ext#100](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/issues/100)).
