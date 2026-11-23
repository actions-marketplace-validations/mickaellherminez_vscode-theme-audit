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
  --config <file>
                 Use this configuration for every theme, instead of the
                 .vscode-theme-audit.json of each extension folder:
                 thresholds, and checks or pairs to ignore with a reason
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

/** The options and the inputs of the command line; `--config <file>` and `--config=<file>` take a value. */
function parseArgs(args: readonly string[]): { flags: Set<string>; config?: string; inputs: string[]; error?: string } {
  const flags = new Set<string>();
  const inputs: string[] = [];
  let config: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--config' || arg.startsWith('--config=')) {
      const value = arg === '--config' ? args[++i] : arg.slice('--config='.length);
      if (value === undefined || value === '' || (arg === '--config' && value.startsWith('-'))) return { flags, inputs, error: '--config needs a file' };
      if (config !== undefined) return { flags, inputs, error: '--config is given twice' };
      config = value;
    } else if (arg.startsWith('-')) {
      if (!OPTIONS.has(arg)) return { flags, inputs, error: `Unknown option: ${arg}` };
      flags.add(arg);
    } else {
      inputs.push(arg);
    }
  }
  return config === undefined ? { flags, inputs } : { flags, config, inputs };
}

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
  const { flags, config, inputs, error } = parseArgs(args);
  if (error !== undefined) {
    output.err(`${error}\n\n${HELP}`);
    return 2;
  }
  if (inputs.length === 0) {
    output.err(HELP);
    return 2;
  }
  let report;
  try {
    report = await auditInputs(inputs, {
      strict: flags.has('--strict'), version: packageVersion(), cwd, ...(config === undefined ? {} : { config }), ...(fetcher ? { fetcher } : {}),
    });
  } catch (error) {
    if (!(error instanceof ThemeError)) throw error;
    output.err(`vscode-theme-audit: ${error.message}\n`);
    return 2;
  }
  output.out(flags.has('--json') ? JSON.stringify(report, null, 2) + '\n' : textReport(report));
  return exitCode(report);
}
