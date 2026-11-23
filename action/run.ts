// The GitHub Action uses the audit engine directly. Inputs are literal values, never shell commands.

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { markdownReport } from '../src/markdown.ts';
import { auditInputs, exitCode } from '../src/report.ts';

export interface ActionOutput {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface ActionOptions {
  /** Fixed at build time from the package manifest, so the bundle needs no files outside itself. */
  version: string;
  env?: Readonly<Record<string, string | undefined>>;
  output?: ActionOutput;
}

const consoleOutput: ActionOutput = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

/** The report remains available after GitHub consumes the summary file of this step. */
function publishReport(markdown: string, code: 0 | 1 | 2, env: Readonly<Record<string, string | undefined>>): void {
  const folder = mkdtempSync(join(env.RUNNER_TEMP ?? tmpdir(), 'vscode-theme-audit-action-'));
  const file = join(folder, 'report.md');
  writeFileSync(file, markdown);
  const summaryFile = env.GITHUB_STEP_SUMMARY;
  if (summaryFile !== undefined && summaryFile !== '') appendFileSync(summaryFile, markdown);
  const outputs = env.GITHUB_OUTPUT;
  if (outputs !== undefined && outputs !== '') {
    // An unpredictable delimiter prevents a path containing newlines from introducing another output.
    const delimiter = `vscode_theme_audit_${randomUUID()}`;
    appendFileSync(outputs, `report-path<<${delimiter}\n${file}\n${delimiter}\nexit-code=${String(code)}\n`);
  }
}

/** A fatal error is data inside preformatted HTML, including paths supplied by the workflow. */
function errorReport(message: string): string {
  const text = message.slice(0, 4000).replace(/[&<>@]/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      default: return '&#64;';
    }
  });
  return `# vscode-theme-audit\n\n**ERROR:** The audit could not complete.\n\n<pre>${text}${message.length > 4000 ? '\n[Error message shortened.]' : ''}</pre>\n`;
}

/** Writes the report before returning the audit exit code, including failures and unreadable themes. */
export async function runAction(options: ActionOptions): Promise<0 | 1 | 2> {
  const env = options.env ?? process.env;
  const output = options.output ?? consoleOutput;
  const summaryFile = env.GITHUB_STEP_SUMMARY;
  try {
    if (summaryFile === undefined || summaryFile === '') throw new Error('GITHUB_STEP_SUMMARY is required to write the job summary');
    const strict = env.INPUT_STRICT ?? 'false';
    if (strict !== 'true' && strict !== 'false') throw new Error('The strict input must be true or false');
    const path = env.INPUT_PATH ?? '.';
    if (path.trim() === '') throw new Error('The path input must name a theme, extension folder, .vsix file, or Open VSX id');
    const config = env.INPUT_CONFIG;
    const report = await auditInputs([path], {
      version: options.version,
      strict: strict === 'true',
      cwd: env.GITHUB_WORKSPACE ?? process.cwd(),
      ...(config === undefined || config === '' ? {} : { config }),
    });
    const code = exitCode(report);
    publishReport(markdownReport(report), code, env);
    const { themes, failures, unreadable } = report.summary;
    output.out(`vscode-theme-audit: ${String(themes)} themes, ${String(failures)} failures, ${String(unreadable)} unreadable. See the job summary.\n`);
    return code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // JSON escaping keeps newlines in paths from introducing GitHub workflow commands in the log.
    output.err(`vscode-theme-audit: ${JSON.stringify(message)}\n`);
    try {
      publishReport(errorReport(message), 2, env);
    } catch (summaryError) {
      output.err(`vscode-theme-audit: could not write the job summary or report: ${JSON.stringify(summaryError instanceof Error ? summaryError.message : String(summaryError))}\n`);
    }
    return 2;
  }
}
