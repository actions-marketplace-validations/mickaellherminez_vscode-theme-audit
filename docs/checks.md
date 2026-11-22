# The checks

Every check of the audit, with the colors it reads, its minimum and where that minimum comes from. The label is the one of the report (`label` in the JSON report). The checks run in this order.

## How a check is measured

- **Contrast:** the contrast ratio of [WCAG 2.2](https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio), from the relative luminance of each color, between 1:1 and 21:1. A transparent background is first composed on the editor background (on the side bar for a list), and a transparent text on its background, as the screen shows them. The report gives both colors after composition.
- **Minimums:** 4.5:1 for text ([1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum), level AA), 3:1 for indicators, borders, icons and lines ([1.4.11 Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)). **In a high contrast theme** (`hc-black`, `hc-light`), every minimum of 4.5 becomes 7 ([1.4.6 Contrast (Enhanced)](https://www.w3.org/TR/WCAG22/#contrast-enhanced), level AAA), except the selected text of the debug console. The minimums for a selection or the current line (1.2 to 3) are project rules: they make sure that the selection shows, not that a text is readable.
- **Main text:** the editor, the terminal, the side bar and the notebook cells need 4.5:1, or 7:1 in strict mode and in high contrast.
- **Colors read:** by default, the colors that VS Code 1.147.0 shows: the theme, then the defaults of VS Code. A check whose color VS Code does not show at all has the status `missing`, which is information. In strict mode, only the colors that the theme sets count, and a missing one is a failure.
- **Color difference:** CIEDE2000 (ΔE2000), as specified in CIE 15:2004, implemented after G. Sharma, W. Wu and E. N. Dalal, *Color Research & Application* 30(1), 2005, and checked against their test data. The report also gives the CIE76 difference (the distance in CIELAB) for information.

In the tables, *4.5* means 4.5:1, and 7:1 in high contrast.

## Editor

| Label | Text | Background | Minimum |
| --- | --- | --- | --- |
| `Editor: text / background` | `editor.foreground` | `editor.background` | main text |
| `Editor: text / current line` | `editor.foreground` | `editor.lineHighlightBackground` (or the background) | main text |
| `Editor: selection visible on the background` | `editor.selectionBackground` | `editor.background` | 1.35 (3 in high contrast) |
| `Editor: selected text` | `editor.foreground` (`editor.selectionForeground` in high contrast) | `editor.selectionBackground` | 4.5 |
| `Editor: inactive selection visible` | `editor.inactiveSelectionBackground` | `editor.background` | 1.25 |
| `Editor: text / inactive selection` | `editor.foreground` | `editor.inactiveSelectionBackground` | 4.5 |
| `Editor: selection distinct from the current line` | `editor.selectionBackground` | `editor.lineHighlightBackground` | 1.2 |
| `Find: text / current match` | `editor.foreground` | `editor.findMatchBackground` | 4.5 |
| `Find: border of the current match` | `editor.findMatchBorder` | `editor.background` | 3 |
| `Find: text / other matches` | `editor.foreground` | `editor.findMatchHighlightBackground` | 4.5 |
| `Occurrences: border` | `editor.selectionHighlightBorder` (or `editor.wordHighlightBorder`) | `editor.background` | 2 (3 in high contrast) |
| `Line numbers` | `editorLineNumber.foreground` | `editor.background` | 4.5 |
| `Active line number` | `editorLineNumber.activeForeground` | `editor.background` | 4.5 |
| `Cursor` | `editorCursor.foreground` | `editor.background` | 3 |
| `Indicator <key>` | `editorError.foreground`, `editorWarning.foreground`, `editorInfo.foreground`, `editorGutter.addedBackground`, `editorGutter.modifiedBackground`, `editorGutter.deletedBackground` | `editor.background` | 3 |
| `Bracket pair 1` to `3` | `editorBracketHighlight.foreground1` to `3` | `editor.background` | 4.5 |
| `Focus indicator` | `focusBorder` | `editor.background` | 3 |

## Terminal and debug console

The terminal background is `terminal.background`; when VS Code has no color for it, the terminal shows `panel.background`, and so does the audit. By default, the text of the terminal is measured as the terminal shows it: xterm.js, the terminal of VS Code, darkens or lightens each character until it reaches 4.5:1 on the terminal background (`terminal.integrated.minimumContrastRatio`). In strict mode, the colors of the theme are measured as they are.

| Label | Text | Background | Minimum |
| --- | --- | --- | --- |
| `Terminal: text / background` | `terminal.foreground` | terminal background | main text |
| `Terminal: selection visible` | `terminal.selectionBackground` | terminal background | 1.35 (3 in high contrast) |
| `Terminal: selected text` | `terminal.selectionForeground` (or `terminal.foreground`) | `terminal.selectionBackground` | 4.5 |
| `Terminal: inactive selection visible` | `terminal.inactiveSelectionBackground` | terminal background | 1.25 |
| `Terminal ANSI <name>` | `terminal.ansi<name>`, the 16 ANSI colors | terminal background | 4.5; 3 for `Black` and `BrightBlack`. Not checked: `Black` in a dark theme, `White` and `BrightWhite` in a light theme that is not high contrast, which are meant for the opposite background |
| `Debug console: selection visible` | `selection.background` | terminal background | 1.35 (2 in high contrast) |
| `Debug console: <name>` | `terminal.foreground`, `debugConsole.infoForeground`, `debugConsole.warningForeground`, `debugConsole.errorForeground`, `debugConsole.sourceForeground` | terminal background | 4.5 |
| `Debug console: <name> selected` | the same | `selection.background` | 4.5, also in high contrast |

## Interface

Each of these checks is labeled with its two keys, `<text> / <background>`. A transparent list background is composed on the side bar.

| Text | Background | Minimum |
| --- | --- | --- |
| `sideBar.foreground` | `sideBar.background` | main text |
| `list.activeSelectionForeground`, `list.inactiveSelectionForeground`, `list.hoverForeground` | the matching `...Background` | 4.5 |
| `list.highlightForeground`, `descriptionForeground`, `list.errorForeground`, `list.warningForeground` | `sideBar.background` | 4.5 |
| `sideBarSectionHeader.foreground` | `sideBarSectionHeader.background` | 4.5 |
| `activityBar.foreground`, `activityBar.inactiveForeground` | `activityBar.background` | 4.5 |
| `activityBarBadge.foreground`, `badge.foreground` | `activityBarBadge.background`, `badge.background` | 4.5 |
| `statusBar.foreground`, `statusBar.debuggingForeground`, `statusBarItem.remoteForeground` | the matching background | 4.5 |
| `statusBarItem.prominentForeground` | `statusBarItem.prominentBackground` and `statusBarItem.prominentHoverBackground` | 4.5 |
| `titleBar.activeForeground`, `titleBar.inactiveForeground` | the matching background | 4.5 |
| `tab.activeForeground`, `tab.inactiveForeground`, `tab.unfocusedActiveForeground` | the matching background | 4.5 |
| `panelTitle.activeForeground`, `panelTitle.inactiveForeground` | `panel.background` | 4.5 |
| `button.foreground` | `button.background` and `button.hoverBackground` | 4.5 |
| `button.secondaryForeground` | `button.secondaryBackground` and `button.secondaryHoverBackground` | 4.5 |
| `input.foreground`, `input.placeholderForeground` | `input.background` | 4.5 |
| `dropdown.foreground` | `dropdown.background` | 4.5 |
| `editorWidget.foreground`, `editorHoverWidget.foreground` | the matching background | 4.5 |
| `editorSuggestWidget.foreground`, `editorSuggestWidget.highlightForeground` | `editorSuggestWidget.background` | 4.5 |
| `editorSuggestWidget.selectedForeground` | `editorSuggestWidget.selectedBackground` | 4.5 |
| `notifications.foreground`, `quickInput.foreground`, `menu.foreground` | the matching background | 4.5 |
| `quickInputList.focusForeground`, `menu.selectionForeground`, `peekViewResult.selectionForeground` | the matching background | 4.5 |
| `peekViewTitleLabel.foreground` | `peekViewTitle.background` | 4.5 |
| `breadcrumb.foreground` | `breadcrumb.background` | 4.5 |
| `textLink.foreground`, `settings.headerForeground` | `editor.background` | 4.5 |
| `textPreformat.foreground` | `textCodeBlock.background` | 4.5 |
| `inputValidation.errorForeground` | `inputValidation.errorBackground` | 4.5 |
| `keybindingLabel.foreground` | `keybindingLabel.background` | 4.5 |
| `gitDecoration.<state>ResourceForeground` (modified, added, deleted, untracked, conflicting) | `sideBar.background` | 4.5 |
| `gitDecoration.ignoredResourceForeground` | `sideBar.background` | 3 |
| `gitDecoration.<state>ResourceForeground` (the same five) | `list.activeSelectionBackground`: a selected file keeps the color of its Git state | 3 |

In high contrast themes, a few defaults of VS Code are meant for another text, and are checked too, labeled with their keys: `terminal.foreground / terminalStickyScrollHover.background`, and in `hc-light` `textPreformat.foreground / textPreformat.background`, `debugView.exceptionLabelForeground / debugView.exceptionLabelBackground` and `statusBarItem.warningForeground / statusBarItem.warningBackground` (4.5, so 7).

## Recent surfaces

| Label | Text | Background | Minimum |
| --- | --- | --- | --- |
| `Chat: slash command / its background` | `chat.slashCommandForeground` | `chat.slashCommandBackground` | 4.5 |
| `Chat: avatar` | `chat.avatarForeground` | `chat.avatarBackground` | 4.5 |
| `Chat: <key> / side bar` | `chat.editedFileForeground`, `chat.linesAddedForeground`, `chat.linesRemovedForeground` | `sideBar.background` | 4.5 |
| `Inline chat: text` | `inlineChat.foreground` | `inlineChat.background` | 4.5 |
| `Inline chat: placeholder` | `inlineChatInput.placeholderForeground` | `inlineChatInput.background` | 4.5 |
| `Testing: <key> / side bar` | `testing.iconPassed`, `testing.iconFailed`, `testing.iconErrored`, `testing.iconQueued`, `testing.iconSkipped`, `testing.iconUnset` | `sideBar.background` | 3 |
| `Testing: testing.runAction / editor` | `testing.runAction` | `editor.background` | 3 |
| `Notebook: text / cell` | `editor.foreground` | `notebook.cellEditorBackground` (the editor background when VS Code has none) | main text |
| `Notebook: token <category> / cell` | the color of each syntax category below that must stay distinct | `notebook.cellEditorBackground` | 4.5 |
| `Notebook: border of the focused cell` | `notebook.focusedCellBorder` | `notebook.editorBackground` | 3 |
| `Merge: text / <key>` | `editor.foreground` | `mergeEditor.change.background`, `mergeEditor.change.word.background`, `mergeEditor.changeBase.background`, `mergeEditor.changeBase.word.background`, `mergeEditor.conflictingLines.background` | 4.5 |
| `Merge: unhandled conflict`, `Merge: handled conflict` | `mergeEditor.conflict.unhandledFocused.border`, `mergeEditor.conflict.handledFocused.border` | `editor.background` | 3 |
| `Multi-diff: text / header` | `foreground` | `multiDiffEditor.headerBackground` | 4.5 |
| `Symbol: <key> / side bar` and `/ suggestions` | each `symbolIcon.*Foreground` | `sideBar.background`, `editorSuggestWidget.background` | 3 |
| `Git graph: line 1` to `5` | `scmGraph.foreground1` to `5` | `sideBar.background` | 3 |
| `Git graph: <key>` | `scmGraph.historyItemRefColor`, `scmGraph.historyItemRemoteRefColor`, `scmGraph.historyItemBaseRefColor` | `sideBar.background` | 3 |
| `Git graph: <key> / hover` | `scmGraph.historyItemHoverAdditionsForeground`, `scmGraph.historyItemHoverDeletionsForeground` | `editorHoverWidget.background` | 4.5 |
| `Command center: text` | `commandCenter.foreground` | `titleBar.activeBackground` | 4.5 |
| `Command center: text (inactive window)` | `commandCenter.inactiveForeground` | `titleBar.inactiveBackground` | 4.5 |
| `Agent sessions: panel text` | `agentsPanel.foreground` | `agentsPanel.background` | 4.5 |
| `Agent sessions: input`, `Agent sessions: placeholder` | `agentsChatInput.foreground`, `agentsChatInput.placeholderForeground` | `agentsChatInput.background` | 4.5 |
| `Agent sessions: badges` | `agentsBadge.foreground` | `agentsBadge.background` | 4.5 |

## Syntax

Each syntax category is the color that the TextMate rules of the theme give to a representative scope, as VS Code resolves it (a rule for `keyword` also colors `keyword.operator`). A category that no rule colors takes the editor text color; in strict mode it is `missing`, except `variable`.

| Category | Scope | Category | Scope |
| --- | --- | --- | --- |
| comment | `comment` | punctuation | `punctuation` |
| keyword | `keyword` | tag | `entity.name.tag` |
| function | `entity.name.function` | attribute | `entity.other.attribute-name` |
| string | `string` | regex | `string.regexp` |
| number | `constant.numeric` | JSON key | `support.type.property-name.json` |
| class | `entity.name.class` | invalid | `invalid` |
| variable | `variable` | operator | `keyword.operator` |

| Label | Text | Background | Minimum |
| --- | --- | --- | --- |
| `Token: <category>` | the category | `editor.background` | 4.5 |
| `Token: <category> selected` | the category (`editor.selectionForeground` in high contrast) | `editor.selectionBackground` | 3 (7 in high contrast) |
| `Semantic: <selector>` | the color of each rule of `semanticTokenColors` | `editor.background` | 4.5 |
| `Semantic: <selector> selected` | the same (`editor.selectionForeground` in high contrast) | `editor.selectionBackground` | 3 (7 in high contrast) |

The semantic checks run when the theme sets `"semanticHighlighting": true`, since VS Code shows the semantic colors only then; in strict mode, always.

## Styles (WCAG 1.4.1)

[WCAG 2.2, 1.4.1 Use of Color](https://www.w3.org/TR/WCAG22/#use-of-color): information must not rely on color alone. The check passes when the font style of the scope, as VS Code resolves it, has the style. Outside strict mode these are information (`"information": true`), since the syntax also shows these tokens (`//`, `#`...) and VS Code itself strikes through deprecated code and underlines errors with diagnostics.

| Label | Scope | Style |
| --- | --- | --- |
| `Style (WCAG 1.4.1): comment in italic` | `comment` | italic |
| `Style (WCAG 1.4.1): invalid code underlined` | `invalid` | underline |
| `Style (WCAG 1.4.1): deprecated code struck through` | `invalid.deprecated` | strikethrough |
| `Style (WCAG 1.4.1): link underlined` | `markup.underline.link` | underline |
| `Style (WCAG 1.4.1): Markdown heading in bold` | `markup.heading` | bold |
| `Style (WCAG 1.4.1): Markdown bold in bold` | `markup.bold` | bold |
| `Style (WCAG 1.4.1): Markdown italic in italic` | `markup.italic` | italic |
| `Style (WCAG 1.4.1): deprecated semantic token struck through` | the semantic rule `*.deprecated` (with semantic highlighting) | strikethrough |

## Colors that must stay distinct

These pairs are compared in each vision (`distinctions` in the JSON report). A pair passes when its CIEDE2000 difference is at least 7 in every vision: a project rule, not a standard. Where the color of one of the two is missing, the pair is left out.

| Group | Colors | Pairs |
| --- | --- | --- |
| Syntax | keyword, function, string, number, class, comment, variable (see [Syntax](#syntax)) | every pair of the seven |
| Alerts | `editorError.foreground`, `editorWarning.foreground`, `editorInfo.foreground` | error / warning, error / info |
| Changes | `editorGutter.addedBackground`, `editorGutter.modifiedBackground`, `editorGutter.deletedBackground` | added / deleted, added / modified, modified / deleted |
| Tests | `testing.iconPassed`, `testing.iconFailed` | test passed / test failed |
| Git graph | `scmGraph.foreground1` to `5` | every pair of the five |

The visions (`view`), and the models of each one: the smallest difference among the models counts, since the models disagree and the pair must stay distinct with all of them.

| View | Models |
| --- | --- |
| `normal` | none |
| `protan` (protanopia) | Machado 2009, Brettel 1997, Viénot 1999 |
| `deutan` (deuteranopia) | Machado 2009, Brettel 1997, Viénot 1999 |
| `tritan` (tritanopia) | Brettel 1997 |

- G. M. Machado, M. M. Oliveira and L. A. F. Fernandes, "A Physiologically-based Model for Simulation of Color Vision Deficiency", *IEEE Transactions on Visualization and Computer Graphics* 15(6), 2009, p. 1291–1298, [DOI 10.1109/TVCG.2009.113](https://doi.org/10.1109/TVCG.2009.113). Severity 1.0 (dichromacy).
- H. Brettel, F. Viénot and J. D. Mollon, "Computerized simulation of color appearance for dichromats", *Journal of the Optical Society of America A* 14(10), 1997, p. 2647–2655.
- F. Viénot, H. Brettel and J. D. Mollon, "Digital video colourmaps for checking the legibility of displays by dichromats", *Color Research & Application* 24(4), 1999, p. 243–252.

The implementations are checked against the published matrices of Machado et al. and against [DaltonLens-Python](https://github.com/DaltonLens/DaltonLens-Python) for Brettel and Viénot (see [test/data/README.md](../test/data/README.md)).

**Achromatopsia** (`achromatopsia` in the JSON report): the seven syntax colors seen without color (the luminance only), every pair with its ΔE2000. Information only: without color, syntax colors often differ only in lightness.

## Strict mode only

`--strict` adds these checks, rules of [365 Day & Night](https://github.com/mickaellherminez/365-daynight-vscode-theme-ext):

| Label | What | Minimum |
| --- | --- | --- |
| `Status bar button / status bar` | `365DayNight.statusBarButton` on `statusBar.background` | 4.5 |
| `Status bar button distinct from the status bar text` | CIE76 difference between `365DayNight.statusBarButton` and `statusBar.foreground` | 15 |
| `Required key: <key>` | recent surfaces whose defaults in VS Code ignore the theme: chat, testing icons, Git graph, merge editor, multi-diff editor and 10 symbol icons (`PRIORITY_KEYS` in the API) | must be set |
| `Semantic: <selector>` | semantic rules that must be set: `variable.readonly`, `parameter`, `function`, `method`, `class`, `enum`, `interface`, `namespace`, `typeParameter`, `enumMember`, `property`, `variable.defaultLibrary`, `keyword`, `comment.documentation` | must be set, then 4.5 |

**Variety** (`variety` in the JSON report): the themes of one type in an extension must look different from each other. Each pair of themes is compared with the CIE76 difference of a few colors:

| Measure | Minimum (CIE76) |
| --- | --- |
| `editor.background` | 8 (4 in high contrast) |
| `sideBar.background` | 7 (4 in high contrast) |
| `activityBarBadge.background` | 25 |
| `syntax`: the difference of the keyword colors of the two themes, then of their function, string, number, class and comment colors; the mean of the six | 18 |
| `statusBar.background` | information |

At most 3 themes of one type may share a hue family, for the editor background and for the accent (`activityBarBadge.background`): 8 sectors of 45° of the CIELAB hue, or neutral when the chroma is under 4. A theme that does not set a color or a syntax category that a measure needs fails the variety. The CIEDE2000 means and the color blindness simulations of these measures (Machado 2009) are information. Variety reads only the colors that each theme sets.
