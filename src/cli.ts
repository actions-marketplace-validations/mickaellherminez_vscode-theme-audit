#!/usr/bin/env node
import { main } from './main.ts';

// A reader that stops early, such as `| head`, closes the pipe: stop quietly, with the exit code of the audit
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
  process.exit(process.exitCode);
});

process.exitCode = main(process.argv.slice(2));
