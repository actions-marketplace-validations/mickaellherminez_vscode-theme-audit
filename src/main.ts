import { readFileSync } from 'node:fs';

import type { Fetcher } from './open-vsx.ts';
import { auditInputs, exitCode, textReport } from './report.ts';
import { ThemeError } from './theme.ts';
import { VSCODE_SOURCE } from './vscode-colors.ts';

/** Where the command writes, so that tests can read what it prints. */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

const consoleOutput: Output = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

export const HELP = `Usage: vscode-theme-audit [options] <theme>...

Accessibility audit for VS Code color themes: WCAG contrast, and color
pairs that must stay distinct with color blindness simulations, measured
on the colors that VS Code ${VSCODE_SOURCE.version} shows. Themes from the Visual Studio
Marketplace and Open VSX use the same format.

A theme is:
  a theme file                     themes/my-theme-color-theme.json
  an extension folder              every theme of its package.json
  a packaged extension             my-theme-1.2.3.vsix
  an extension of Open VSX         open-vsx:publisher.name[@version]
                                   (downloaded from open-vsx.org)

Options:
  --json         Print the report as JSON, for CI (format 1, described by
                 schema/report-v1.schema.json in the package)
  --strict       Apply the rules of 365 Day & Night: every color that a check
                 uses must be set by the theme, 7:1 for the main text, the
                 styles of WCAG 1.4.1, required keys and semantic rules, and
                 the variety between the themes of an extension
  -h, --help     Show this help
  -v, --version  Show the version

Exit codes:
  0  every check passes
  1  a check fails
  2  a theme cannot be read, or the command is misused
`;

const OPTIONS = new Set(['-h', '--help', '-v', '--version', '--json', '--strict']);

/** Version of the package, read from its package.json (one folder above src/ and dist/). */
export function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

/**
 * Runs the command and resolves to its exit code: 0 when every check passes, 1 when one fails, 2 for an error.
 * `fetcher` downloads the extensions of Open VSX (fetch by default).
 */
export async function main(args: readonly string[], output: Output = consoleOutput, cwd = process.cwd(), fetcher?: Fetcher): Promise<number> {
  if (args.includes('-h') || args.includes('--help')) {
    output.out(HELP);
    return 0;
  }
  if (args.includes('-v') || args.includes('--version')) {
    output.out(`${packageVersion()}\n`);
    return 0;
  }
  const unknown = args.find((arg) => arg.startsWith('-') && !OPTIONS.has(arg));
  if (unknown) {
    output.err(`Unknown option: ${unknown}\n\n${HELP}`);
    return 2;
  }
  const paths = args.filter((arg) => !arg.startsWith('-'));
  if (paths.length === 0) {
    output.err(HELP);
    return 2;
  }
  let report;
  try {
    report = await auditInputs(paths, { strict: args.includes('--strict'), version: packageVersion(), cwd, ...(fetcher ? { fetcher } : {}) });
  } catch (error) {
    if (!(error instanceof ThemeError)) throw error;
    output.err(`vscode-theme-audit: ${error.message}\n`);
    return 2;
  }
  output.out(args.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : textReport(report));
  return exitCode(report);
}
