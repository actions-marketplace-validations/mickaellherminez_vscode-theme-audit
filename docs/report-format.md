# The JSON report, format 1

`vscode-theme-audit --json` prints one JSON document on the standard output. It is described by the schema [`schema/report-v1.schema.json`](../schema/report-v1.schema.json) (JSON Schema 2020-12), published in the package (`node_modules/vscode-theme-audit/schema/report-v1.schema.json` once installed). The API gives the same object: `auditInputs()`, or `auditPaths()` for theme files and folders (see the [README](../README.md#api)).

`--format json` and `--format=json` select the same document; `--json` remains an alias. Text is the default, and `--format markdown` produces a [bounded report for PR comments and job summaries](../README.md#the-markdown-report). These are renderers of the same audit and have the same exit codes. Contradictory format choices fail with code 2. To return to text, remove the format option or use `--format text`. The Markdown renderer does not change JSON format 1.

## Versions

`format` is the version of this format. **Format 1 can gain fields**: read the fields you need and ignore the others. A field removed, renamed or changing meaning gives format 2, with a new schema file, announced in the [CHANGELOG](../CHANGELOG.md). The schema of format 1 refuses unknown fields, so a report of a later 1.x release can fail the schema of an earlier one: validate a report with the schema of the package that wrote it.

The numbers are not rounded: round them for display (the text report gives contrast ratios to 2 decimals and color differences to 1). Colors are uppercase, `#RRGGBB`, or `#RRGGBBAA` when transparent.

When the command fails before the audit (a path that does not exist, a folder without themes, an unknown option), it exits with code 2 and prints no JSON: the reason is on the standard error. A theme that cannot be read is still in the report, with its `error`.

## Example

The report of a test theme of this repository, with each list cut to one entry:

```json
{
  "format": 1,
  "tool": { "name": "vscode-theme-audit", "version": "0.2.0" },
  "vscode": { "version": "1.147.0", "commit": "8a14f0cc1b08d531eb83255ea3764ae22aa932b5" },
  "strict": false,
  "minimumDeltaE2000": 7,
  "warnings": [],
  "themes": [
    {
      "label": "Oracle Dark",
      "file": "test/data/oracle-extension/themes/dark.json",
      "uiTheme": "vs-dark",
      "warnings": [],
      "summary": { "checks": 263, "failed": 16, "missing": 8, "information": 7, "pairs": 148, "confused": 84, "ignored": 0 },
      "checks": [
        { "label": "Line numbers", "value": 4.317608886674965, "minimum": 4.5, "status": "fail", "colors": ["#858585", "#1B2230"] }
      ],
      "distinctions": [
        { "view": "deutan", "pair": ["keyword", "function"], "deltaE2000": 0, "model": "Machado 2009", "cie76": 0, "colors": ["#D8DEE9", "#D8DEE9"], "status": "fail" }
      ],
      "achromatopsia": [
        { "pair": ["keyword", "function"], "deltaE2000": 0, "cie76": 0, "colors": ["#D8DEE9", "#D8DEE9"] }
      ]
    }
  ],
  "variety": [],
  "summary": { "themes": 1, "themesWithFailures": 1, "failures": 100, "unreadable": 0 }
}
```

## The report

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | `1` | The version of this format |
| `tool.name` | `"vscode-theme-audit"` | |
| `tool.version` | string | The version of the package that wrote the report |
| `vscode.version`, `vscode.commit` | string | The release of VS Code whose default colors and rules the audit follows, and its commit (40 hexadecimal digits) |
| `strict` | boolean | Whether the rules of 365 Day & Night were applied (`--strict`) |
| `minimumDeltaE2000` | number | The default CIEDE2000 difference under which two colors that must stay distinct are confused: 7. A configuration can change it for its themes (`thresholds`) |
| `warnings` | string[] | Warnings about the extensions themselves: their `package.json` and the colors they contribute |
| `themes` | object[] | One entry per theme, in the order of the paths, then of `contributes.themes` (see [A theme](#a-theme)) |
| `variety` | object[] | In strict mode, one entry per extension folder given as a path and per theme type with two themes or more (see [Variety](#variety)). Empty otherwise |
| `summary.themes` | integer | Themes audited, unreadable ones included |
| `summary.themesWithFailures` | integer | Themes with at least one failure |
| `summary.failures` | integer | Failed checks, plus confused pairs counted once in each vision where they are confused, plus variety failures. The exit code is `1` when it is not 0 |
| `summary.unreadable` | integer | Themes that cannot be read. The exit code is `2` when it is not 0 |

## A theme

| Field | Type | Meaning |
| --- | --- | --- |
| `label` | string | The name of the theme, as VS Code shows it in the theme picker |
| `file` | string | The theme file, relative to the folder where the command ran. In a `.vsix`, the `.vsix` then the path inside it (`my-theme-1.2.3.vsix/extension/themes/dark.json`); for an Open VSX id, the id with the version found (`open-vsx:publisher.name@1.2.3/extension/themes/dark.json`) |
| `uiTheme` | `"vs"`, `"vs-dark"`, `"hc-black"`, `"hc-light"` | Its type: light, dark, high contrast dark, high contrast light |
| `warnings` | string[] | What VS Code accepts but the author probably did not mean: an invalid color shown in red, a value that is not a color, a file name whose case differs. Not failures |
| `config` | string | Only with a configuration: its file (`.vscode-theme-audit.json` or `--config`) |
| `thresholds` | object | Only when the configuration changes them: `text`, `enhancedText`, `nonText` and `deltaE2000` |
| `error` | string | Only when the theme cannot be read: why. The fields below are then absent |
| `summary.checks` | integer | Number of checks |
| `summary.failed` | integer | Checks that fail (in strict mode, missing colors included), without those that the configuration ignores |
| `summary.missing` | integer | Outside strict mode: colors that VS Code does not show, for information |
| `summary.information` | integer | Checks for information that do not pass: the styles of WCAG 1.4.1, outside strict mode |
| `summary.pairs` | integer | Entries of `distinctions`: each pair of colors that must stay distinct, once in each of the 4 visions |
| `summary.confused` | integer | Entries of `distinctions` that fail: a pair confused in 2 visions counts 2. Ignored pairs are not counted |
| `summary.ignored` | integer | Checks and entries of `distinctions` that fail, but that the configuration ignores |
| `checks` | object[] | Every check (see [A check](#a-check)) |
| `distinctions` | object[] | Every pair in every vision (see [A pair](#a-pair)) |
| `achromatopsia` | object[] | The syntax colors seen without color: information only |

## A check

| Field | Type | Meaning |
| --- | --- | --- |
| `label` | string | What is checked. [docs/checks.md](checks.md) lists the labels, with their keys |
| `value` | number or `null` | The contrast ratio (1 to 21), or a color difference; `null` for a style or a missing color |
| `minimum` | number or string | The minimum value, or the style expected: `"italic"`, `"bold"`, `"underline"`, `"strikethrough"` |
| `status` | `"pass"`, `"fail"`, `"missing"` | `missing`: a color the check needs is not there, a failure only in strict mode |
| `information` | `true` | Present only on checks measured for information, which are never failures |
| `ignored` | string | Present only on checks that the configuration ignores: its reason. They are never failures |
| `colors` | [string, string] | Present when both colors exist: the text and the background as shown, opaque, after a transparent color is composed on what is under it |

A check is a failure when it has neither `information: true` nor `ignored`, and its `status` is `"fail"` (or `"missing"` in strict mode). This is `isFailure(check, strict)` in the API. The `minimum` of a check is the threshold of the configuration, when it changes the default one.

## A pair

| Field | Type | Meaning |
| --- | --- | --- |
| `view` | `"normal"`, `"protan"`, `"deutan"`, `"tritan"` | The vision: normal, protanopia, deuteranopia, tritanopia |
| `pair` | [string, string] | The two colors to tell apart: syntax categories (`keyword`...), alerts (`error`...), changes (`added`...), tests (`test passed`...) or Git graph lines (`Git graph 1`...) |
| `deltaE2000` | number | The smallest CIEDE2000 difference among the models of this vision |
| `model` | string or `null` | The model that gives it: `"Machado 2009"`, `"Brettel 1997"` or `"Viénot 1999"`; `null` in normal vision |
| `cie76` | number | The CIE76 difference with the same model, for information |
| `colors` | [string, string] | The two colors, as the theme shows them (not simulated) |
| `status` | `"pass"`, `"fail"` | `fail` when `deltaE2000` is under `minimumDeltaE2000`, or under the `deltaE2000` threshold of the configuration |
| `ignored` | string | Present only on pairs that the configuration ignores: its reason. They are never failures |

An entry of `achromatopsia` has `pair`, `deltaE2000`, `cie76` (both measured on the colors seen without color) and `colors` (as the theme shows them), and no `status`.

## Variety

Strict mode only: the themes of one type in an extension compared with each other. See [docs/checks.md](checks.md#strict-mode-only).

| Field | Type | Meaning |
| --- | --- | --- |
| `folder` | string | The extension folder |
| `uiTheme` | string | The theme type compared |
| `themes` | string[] | The themes of this type |
| `measures[].measure` | string | A workbench color, or `syntax` for the mean of 6 syntax colors |
| `measures[].threshold` | number or `null` | The CIE76 minimum between two themes; `null` for information |
| `measures[].pairs` | object[] | Every pair of themes, `{ "themes": [a, b], "deltaE": number }`, from the closest to the farthest |
| `measures[].meanDeltaE2000` | number | The mean CIEDE2000 difference, for information |
| `measures[].colorBlindness` | object or `null` | The same pairs with the protan, deutan and tritan simulations of Machado 2009, for information; `null` for a measure without threshold |
| `families` | object | For `editor.background` and `activityBarBadge.background`: the hue family of each theme |
| `maxPerFamily` | integer | The most themes allowed in one family: 3 |
| `missing` | string[] | Themes without a color or a syntax category that a measure needs |
| `failures` | string[] | Each variety failure, as the text report writes it |

## Reading it in a script

With [jq](https://jqlang.org/), the failed checks of each theme:

```sh
vscode-theme-audit . --json | jq -r '.strict as $strict | .themes[] | .label as $t | .checks[]? | select((.information | not) and (.ignored | not) and (.status == "fail" or ($strict and .status == "missing"))) | "\($t): \(.label) \(.value) < \(.minimum)"'
```

With Node.js:

```js
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('theme-audit.json', 'utf8'));
if (report.format !== 1) throw new Error(`Unknown report format ${report.format}`);
for (const theme of report.themes) {
  const confused = new Set(theme.distinctions?.filter((d) => d.status === 'fail' && d.ignored === undefined).map((d) => d.pair.join(' / ')));
  console.log(theme.label, theme.summary?.failed ?? 'unreadable', [...confused]);
}
```
