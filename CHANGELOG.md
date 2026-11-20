# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- The measuring tools, ported from `colorlib.py` of 365 Day & Night with the same results: WCAG 2 contrast, alpha compositing, CIELAB, CIE76 and CIEDE2000, and the color blindness simulations of Machado et al. 2009, Brettel et al. 1997 and Viénot et al. 1999, with the models kept for each deficiency. Tested against published data (Sharma et al. 2005, Machado et al. 2009), DaltonLens, and the results of `colorlib.py`.
- The package and its command, with `--help` and `--version` only. TypeScript run directly by Node.js 22.18 or later, ESLint, tests with the test runner of Node.js, CI on Node.js 22 and 24, and CodeQL ([365-daynight-vscode-theme-ext#100](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/issues/100)).
