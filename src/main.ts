import { readFileSync } from 'node:fs';

/** Where the command writes, so that tests can read what it prints. */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

const consoleOutput: Output = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

export const HELP = `Usage: vscode-theme-audit [options] <theme file or extension folder>

Accessibility audit for VS Code color themes: WCAG contrast, and color
pairs that must stay distinct with color blindness simulations.
Themes from the Visual Studio Marketplace and Open VSX use the same format.

Options:
  -h, --help     Show this help
  -v, --version  Show the version

This version only sets up the package: the reading engine and the checks
are in progress (https://github.com/mickaellherminez/365-daynight-vscode-theme-ext/issues/100).
`;

/** Version of the package, read from its package.json (one folder above src/ and dist/). */
export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

/** Runs the command and returns its exit code: 0 on success, 2 for a usage error. */
export function main(args: readonly string[], output: Output = consoleOutput): number {
  if (args.includes('-h') || args.includes('--help')) {
    output.out(HELP);
    return 0;
  }
  if (args.includes('-v') || args.includes('--version')) {
    output.out(`${packageVersion()}\n`);
    return 0;
  }
  const unknown = args.find((arg) => arg.startsWith('-'));
  if (unknown) {
    output.err(`Unknown option: ${unknown}\n\n${HELP}`);
    return 2;
  }
  if (args.length === 0) {
    output.err(HELP);
    return 2;
  }
  output.err('The audit of a theme is not available yet: this version only sets up the package.\n');
  return 2;
}
