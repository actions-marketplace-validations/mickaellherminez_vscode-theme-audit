import manifest from '../package.json' with { type: 'json' };

import { runAction } from './run.ts';

// The build embeds the manifest version and every dependency. No npm install runs in the caller's project.
void runAction({ version: manifest.version }).then((code) => {
  process.exitCode = code;
}, (error: unknown) => {
  process.stderr.write(`vscode-theme-audit: ${JSON.stringify(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 2;
});
