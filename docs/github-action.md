# GitHub Action

The action is included in the 0.2.0 sources. It is JavaScript with the audit engine and dependencies bundled in `action/dist/index.cjs`, running with the GitHub Actions Node.js 24 runtime. It can run from a reviewed public commit before the corresponding npm release is published. The bundled engine follows the code at the chosen action commit, independently of which npm version is installed in the caller's project.

## Run it

See the [workflow in the README](../README.md#github-action). It pins the reviewed 0.2.0 action commit `0f287bd6b42642f5c5f5d1c5e8c497630f695a57`, which embeds engine version 0.2.0 independently of npm publication. A full SHA keeps the engine and its checks fixed; changing it is an explicit update. The action does not select npm `latest` and has no separate engine-version input.

Check out the theme repository first. `path` is relative to that workspace (`GITHUB_WORKSPACE`), including when the action itself comes from another repository. No npm install or `setup-node` step is required. A self-hosted runner must support Node.js 24 actions; use a current runner release as described in the [GitHub metadata reference](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax#runsusing).

| Input | Default | Meaning |
| --- | --- | --- |
| `path` | `.` | One theme file, extension folder, `.vsix` or `open-vsx:publisher.name[@version]` id. Spaces are part of the path; it is not a shell command or a list of arguments |
| `strict` | `false` | `true` applies the rules of 365 Day & Night. Any value other than `true` or `false` is an error |
| `config` | empty | A configuration file, relative to the workspace, for this input. When empty, the engine finds `.vscode-theme-audit.json` as the command does, including inside a `.vsix` |

All [input formats](../README.md#usage) and [configuration rules](../README.md#configuration) are those of the command. For example, change `path` to `themes/dark.json`, `my-theme-1.2.3.vsix`, or `open-vsx:publisher.name@1.2.3`. Local inputs need no network access from the engine; an Open VSX id downloads the extension and verifies its published SHA-256. A floating id without `@version` follows the latest extension release even when the action SHA is fixed.

The workflow needs only `contents: read` for checkout. The action needs no token, executes no code from the audited extension, and posts no PR comments. Its inputs are passed directly to the engine, without a shell. It does not modify the themes. The checkout step and GitHub's download of the action still use the network.

## Report and status

The Markdown report is appended to `$GITHUB_STEP_SUMMARY` before the action returns. Audit failures still produce a report. A missing path, invalid configuration or invalid input also produces an error report. If the runner cannot write the report, the action fails and logs the error.

| Exit code | Step result |
| --- | --- |
| `0` | Success: all checks pass |
| `1` | Failure: a check or pair fails, or strict variety fails |
| `2` | Failure: an input, configuration or theme cannot be read, or the report cannot be written |

Do not add `continue-on-error` to a production audit if it must block the job. The demonstration uses it only for deliberate failures, then asserts their outcomes. Another step that uses `if: always()` can inspect the saved report even after an audit failure.

| Output | Meaning |
| --- | --- |
| `report-path` | Absolute path to a UTF-8 Markdown copy in `RUNNER_TEMP`, available for the rest of the job. Its content is the same as the report appended to the summary |
| `exit-code` | `0`, `1` or `2`. Outputs may be absent when the runner cannot write them |

To keep a report as an artifact, give the audit step `id: audit`, then add:

```yaml
- uses: actions/upload-artifact@v7
  if: ${{ always() && steps.audit.outputs.report-path != '' }}
  with:
    name: theme-audit
    path: ${{ steps.audit.outputs.report-path }}
```

The report has the [same content and size limit as `--format markdown`](../README.md#the-markdown-report): at most 60,000 UTF-8 bytes, complete global totals, and an explicit notice if details were omitted. The copy is also Markdown; use the command with `--json` or `--format json` in a separate step if every result is needed. The action does not automatically publish the Markdown as a comment; posting one is a separate workflow decision with its own permissions.

## Demonstration and verification

The demonstration lives in this repository: [`.github/workflows/action.yml`](../.github/workflows/action.yml). It uses the copies of the 365 Day & Night themes and the Oracle test themes already present in `test/data`, without changing another project or creating an example repository. It runs on Linux, Windows and macOS, calls the shipped action from the checked-out commit without installing npm dependencies, and exercises:

- the 48 reference themes, in strict mode, expected to pass;
- an Oracle theme expected to fail, with an explicit configuration whose ignored reason must remain visible;
- a configuration file that does not exist, expected to give an error report.

A following step asserts the expected step outcomes, exit codes and saved report contents. The report also appears in the job summary; inspect its actual GitHub rendering when the workflow has run. This is a demonstration and integration test in the action's own repository, not a claim that another repository has adopted it.

The normal CI separately checks the source tests, that the bundle and licenses match a fresh build, and that the bundle runs from an isolated folder without `node_modules` or this repository's sources.

The [public action test](../.github/workflows/action-public.yml) calls `mickaellherminez/vscode-theme-audit@0f287bd6b42642f5c5f5d1c5e8c497630f695a57` for the same three cases on Ubuntu. Its non-cone sparse checkout contains only the fixtures, their configuration and the assertion script. A guard checks that the local action metadata, bundle, engine sources and `node_modules` are absent: GitHub must download the action at the public SHA. No new repository is created. This targeted download check complements the three-system local-action demonstration above. Inspect its actual GitHub summary after the workflow runs; adding this file alone does not establish that the run passed.

The public test records one fixed revision, while the local-action demonstration always tests the candidate commit. To check another public version, commit and review the action changes, then update all three `uses` references in the public test and the matching SHA references in the README, this guide and CONTRIBUTING. Both commits can be pushed together; GitHub can then download the reviewed action commit from the branch history. Run the workflow and inspect its summary. Restore the previous references to go back. Before a Marketplace listing, verify that these references and the resulting check identify the intended action version.

## Publication on the Marketplace

The owner publishes the listing on github.com after validation. A listing is separate from publishing the npm package. Read the current [GitHub publication requirements](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace) before publishing: GitHub requires a public repository containing the metadata, code and files necessary for the action, an action metadata file at the root, an eligible unique name, acceptance of its Marketplace agreement, and two-factor authentication to publish the release. The metadata name is `VS Code Theme Audit`; its availability is not established by this source change. GitHub validates it in the publication form.

Coordinate the listing with the existing release process: a new `vX.Y.Z` tag in this repository starts the npm release workflow. Do not create another version tag merely to try the Marketplace form. After the 0.2.0 release exists and its checks pass, the owner can edit that release on github.com, select **Publish this Action to the GitHub Marketplace**, validate the name and categories, accept the agreement if needed, and save. Do not change the existing tag to publish the listing. The availability and acceptance checks on github.com are still required.

## Update or remove it

To update, replace the action SHA with the reviewed SHA of the intended release, read its CHANGELOG and run the workflow. To go back, restore the previous SHA and configuration. A report states the embedded engine's version and the pinned VS Code version.

To remove the audit from a consumer repository, delete its action step and any artifact step, or the whole workflow if it serves only this audit. No npm package was installed by the action. Reports in `RUNNER_TEMP` last for the job; GitHub manages hosted-runner cleanup and a self-hosted runner's owner manages its cleanup. Previous job summaries and uploaded artifacts remain until their workflow runs or artifacts are removed under the repository's retention settings.

To remove the demonstrations from this repository, remove `.github/workflows/action.yml` and `.github/workflows/action-public.yml`; the normal engine checks remain. To remove a Marketplace listing, edit each listed release and clear its Marketplace publication checkbox as described in GitHub's documentation. Removing a listing does not invalidate the code at a SHA already used by a workflow.
