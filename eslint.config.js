import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // test/data/inspect/: code samples that VS Code colors (scripts/vscode-inspect.ts), not code of the package
  { ignores: ['dist/', 'action/dist/', 'node_modules/', '.cache/', 'test/data/inspect/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // node:test runs the tests that test() registers: its promise does not need to be awaited
      '@typescript-eslint/no-floating-promises': ['error', {
        allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'describe', 'suite', 'it'] }],
      }],
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
