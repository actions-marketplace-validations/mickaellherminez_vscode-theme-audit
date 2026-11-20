# Contributing

## Setup

Node.js 22.18 or later runs the TypeScript files directly, by removing the types: no build is needed to run the tests or the command. Only syntax that can be removed this way is allowed (no `enum`, no `namespace`), and imports between source files use the `.ts` extension. The build rewrites them to `.js`.

```sh
npm ci
node src/cli.ts --help   # run the command from the sources
```

## Checks

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint, with the strict type-checked rules of typescript-eslint |
| `npm run typecheck` | TypeScript, without writing files |
| `npm test` | The tests of `test/`, with the test runner of Node.js |
| `npm run build` | Compiles `src/` to `dist/`, the only folder published to npm |
| `npm run check` | All of the above, in this order |

The [CI workflow](.github/workflows/ci.yml) runs them on every push and pull request, with Node.js 22 and 24. It also runs the built command and lists the content of the package (`npm pack --dry-run`).

## Pull requests

Each change starts from an issue, and its pull request links to it. Describe what changes, what you checked, and update the [CHANGELOG](CHANGELOG.md).
