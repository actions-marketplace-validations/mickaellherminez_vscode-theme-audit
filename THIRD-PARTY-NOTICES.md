# Third-party notices

Parts of this package are ported from projects of Microsoft, under the MIT License:

- `src/textmate.ts` and `test/textmate.test.ts`: from `src/theme.ts` and `src/tests/themes.test.ts` of [vscode-textmate](https://github.com/microsoft/vscode-textmate) (commit 98cc6331dc).
- `src/semantic.ts` and the first tests of `test/semantic.test.ts`: from `tokenClassificationRegistry.ts`, `colorThemeData.ts`, `textMateScopeMatcher.ts` and `tokenStyleResolving.test.ts`, and the `semanticTokenScopes` of the built-in extensions `javascript` and `typescript-basics`, of [Visual Studio Code](https://github.com/microsoft/vscode) (1.147.0): how a semantic token gets its style.
- `src/colors.ts` and the first tests of `test/colors.test.ts`: from `color.ts`, `colorUtils.ts`, `colorThemeData.ts`, `colorExtensionPoint.ts`, `color.test.ts` and `colorUtils.test.ts` of [Visual Studio Code](https://github.com/microsoft/vscode) (1.147.0): the colors of VS Code, their transforms, and how a default color is resolved.
- `src/vscode-colors.ts`: the default colors that [Visual Studio Code](https://github.com/microsoft/vscode) registers (1.147.0), extracted from its sources by `scripts/vscode-colors.ts`.
- `src/theme.ts` and `src/tokens.ts`: rules of `colorThemeData.ts` and `themeCompatibility.ts` of [Visual Studio Code](https://github.com/microsoft/vscode) (1.147.0): how a color theme is loaded, which TextMate rules it gives, and the default colors involved.
- `src/vsix.ts`: `extract()` of `src/vs/base/node/zip.ts` of [Visual Studio Code](https://github.com/microsoft/vscode) (1.147.0): how an extension is extracted from its `.vsix`, with [yauzl](https://github.com/thejoshwolfe/yauzl) (MIT), a dependency of this package.

`terminalColor()` in `src/audit.ts`, and the expected colors of its test in `test/audit.test.ts`: from `rgba.ensureContrastRatio` in `src/common/Color.ts` of [xterm.js](https://github.com/xtermjs/xterm.js) 6.1.0-beta.337, the terminal of VS Code 1.147.0, under the MIT License: how the terminal changes the color of a text to reach its minimum contrast.

## vscode-textmate

The MIT License (MIT)

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Visual Studio Code

MIT License

Copyright (c) 2015 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## xterm.js

Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
