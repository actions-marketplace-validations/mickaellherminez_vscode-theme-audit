// Extracts the default colors of VS Code from its sources, and writes src/vscode-colors.ts.
//
//   node scripts/vscode-colors.ts <VS Code checkout> [output file]
//
// The checkout must be a clone of microsoft/vscode at the pinned release (see CONTRIBUTING.md). The script follows
// the static imports of the desktop workbench (src/vs/workbench/workbench.desktop.main.ts), the way the compiled
// code loads its modules, and evaluates every call of registerColor in them: the id and the defaults for the four
// theme types. Then it adds the colors that the built-in extensions contribute in their package.json. It stops with
// an error on any code it cannot evaluate, rather than guess.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

const ENTRY = 'src/vs/workbench/workbench.desktop.main.ts';
const COLOR_UTILS = 'src/vs/platform/theme/common/colorUtils.ts';
const COLOR_CLASS = 'src/vs/base/common/color.ts';
const THEME_TYPES = ['light', 'dark', 'hcDark', 'hcLight'] as const;

/** A color written as a Color object in the sources (Color.white, new Color(new RGBA(...))). */
interface ColorLiteral { rgba: [number, number, number, number] }
/** A transform of colorUtils.ts, with the name of its ColorTransformType. */
interface Transform { op: string; [key: string]: Value }
type Value = string | number | boolean | null | undefined | ColorLiteral | Transform | Value[] | { [key: string]: Value } | Opaque;
/** Something the evaluation needs to carry but that is not data: a namespace import, a function, an enum. */
class Opaque {
  readonly kind: 'namespace' | 'function' | 'enum' | 'class';
  readonly module: string;
  readonly name: string;
  constructor(kind: Opaque['kind'], module: string, name: string) {
    this.kind = kind;
    this.module = module;
    this.name = name;
  }
}

const TRANSFORMS: Readonly<Record<string, readonly string[]>> = {
  darken: ['value', 'factor'],
  lighten: ['value', 'factor'],
  transparent: ['value', 'factor'],
  withOpacity: ['value', 'opacity'],
  opaque: ['value', 'background'],
  ifDefinedThenElse: ['if', 'then', 'else'],
  lessProminent: ['value', 'background', 'factor', 'transparency'],
};
const TRANSFORM_OPS: Readonly<Record<string, string>> = {
  darken: 'darken', lighten: 'lighten', transparent: 'transparent', withOpacity: 'opacity', opaque: 'opaque',
  oneOf: 'oneOf', ifDefinedThenElse: 'ifDefinedThenElse', lessProminent: 'lessProminent',
};
/** Members of ColorTransformType (colorUtils.ts), for transforms written as object literals. */
const ENUM_OPS: Readonly<Record<string, string>> = {
  Darken: 'darken', Lighten: 'lighten', Transparent: 'transparent', Opaque: 'opaque', OneOf: 'oneOf',
  LessProminent: 'lessProminent', IfDefinedThenElse: 'ifDefinedThenElse', Mix: 'mix', Opacity: 'opacity',
};
const NAMED_COLORS: Readonly<Record<string, ColorLiteral['rgba']>> = {
  white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1], blue: [0, 0, 255, 1], green: [0, 255, 0, 1],
  cyan: [0, 255, 255, 1], lightgrey: [211, 211, 211, 1], transparent: [0, 0, 0, 0],
};

class EvaluationError extends Error {}

function fail(node: ts.Node, message: string): never {
  const file = node.getSourceFile();
  const { line, character } = file.getLineAndCharacterOfPosition(node.getStart());
  throw new EvaluationError(`${file.fileName}:${String(line + 1)}:${String(character + 1)}: ${message}: ${node.getText().slice(0, 120)}`);
}

interface Import { module: string; name: string }
interface Module {
  file: string;
  source: ts.SourceFile;
  /** Local name -> imported binding ('*' for a namespace import). */
  imports: Map<string, Import>;
  /** Exported name -> local name. */
  exports: Map<string, string>;
  reexports: Map<string, Import>;
  starExports: string[];
  /** Modules loaded by this one, in the order of its import declarations. */
  dependencies: string[];
}

class Sources {
  readonly root: string;
  readonly modules = new Map<string, Module>();
  /** Modules in the order they are evaluated (depth first, dependencies before the module). */
  readonly order: string[] = [];
  private readonly values = new Map<string, Value>();

  constructor(root: string) {
    this.root = root;
  }

  path(file: string): string {
    return relative(this.root, file);
  }

  private resolveSpecifier(from: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    const base = resolve(dirname(from), specifier);
    for (const candidate of [base.replace(/\.js$/, '.ts'), `${base}.ts`, base.replace(/\.js$/, '.tsx')]) {
      if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
        if (existsSync(candidate)) return candidate;
      }
    }
    return undefined;
  }

  module(file: string): Module {
    const known = this.modules.get(file);
    if (known) return known;
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const used = valueIdentifiers(source);
    const module: Module = { file, source, imports: new Map(), exports: new Map(), reexports: new Map(), starExports: [], dependencies: [] };
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = this.resolveSpecifier(file, statement.moduleSpecifier.text);
        const clause = statement.importClause;
        if (!clause) {
          if (target) module.dependencies.push(target);
          continue;
        }
        if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
        const names: [string, string][] = [];
        if (clause.name) names.push([clause.name.text, 'default']);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) names.push([bindings.name.text, '*']);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (!element.isTypeOnly) names.push([element.name.text, (element.propertyName ?? element.name).text]);
          }
        }
        // TypeScript removes an import whose bindings are only used as types: the module is then not loaded
        if (!target || !names.some(([local]) => used.has(local))) continue;
        module.dependencies.push(target);
        for (const [local, name] of names) module.imports.set(local, { module: target, name });
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) continue;
        const specifier = statement.moduleSpecifier;
        const target = specifier && ts.isStringLiteral(specifier) ? this.resolveSpecifier(file, specifier.text) : undefined;
        if (specifier && !target) continue;
        if (target) module.dependencies.push(target);
        const clause = statement.exportClause;
        if (!clause) {
          if (target) module.starExports.push(target);
        } else if (ts.isNamespaceExport(clause)) {
          if (target) module.reexports.set(clause.name.text, { module: target, name: '*' });
        } else {
          for (const element of clause.elements) {
            if (element.isTypeOnly) continue;
            const name = (element.propertyName ?? element.name).text;
            if (target) module.reexports.set(element.name.text, { module: target, name });
            else module.exports.set(element.name.text, name);
          }
        }
      } else if (hasExport(statement)) {
        for (const name of declaredNames(statement)) module.exports.set(name, name);
      }
    }
    this.modules.set(file, module);
    return module;
  }

  /** Loads the modules reachable from the entry, and records their evaluation order. */
  load(entry: string): void {
    const visited = new Set<string>();
    // Iterative depth-first traversal: the import graph of VS Code is deep
    const stack: { file: string; next: number }[] = [{ file: entry, next: 0 }];
    visited.add(entry);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const dependencies = this.module(top.file).dependencies;
      const next = dependencies[top.next];
      if (next === undefined) {
        this.order.push(top.file);
        stack.pop();
        continue;
      }
      top.next++;
      if (!visited.has(next)) {
        visited.add(next);
        stack.push({ file: next, next: 0 });
      }
    }
  }

  /** The value of an exported name of a module. */
  exported(file: string, name: string, seen: Set<string> = new Set()): Value {
    const key = `${file}#${name}`;
    if (seen.has(key)) throw new EvaluationError(`circular export of ${name} in ${this.path(file)}`);
    seen.add(key);
    const module = this.module(file);
    if (name === '*') return new Opaque('namespace', file, '*');
    const local = module.exports.get(name);
    if (local !== undefined) return this.moduleValue(module, local);
    const reexport = module.reexports.get(name);
    if (reexport) return this.exported(reexport.module, reexport.name, seen);
    for (const star of module.starExports) {
      if (this.exports(star, name)) return this.exported(star, name, seen);
    }
    throw new EvaluationError(`${this.path(file)} does not export ${name}`);
  }

  private exports(file: string, name: string, seen: Set<string> = new Set()): boolean {
    if (seen.has(file)) return false;
    seen.add(file);
    const module = this.module(file);
    return module.exports.has(name) || module.reexports.has(name) || module.starExports.some((star) => this.exports(star, name, seen));
  }

  /** The value of a name declared at the top level of a module, or imported by it. */
  moduleValue(module: Module, name: string): Value {
    const key = `${module.file}#${name}`;
    if (this.values.has(key)) return this.values.get(key);
    const imported = module.imports.get(name);
    let value: Value;
    if (imported) {
      value = this.exported(imported.module, imported.name);
    } else {
      const declaration = findDeclaration(module.source.statements, name);
      if (!declaration) throw new EvaluationError(`${this.path(module.file)}: cannot find ${name}`);
      value = this.declarationValue(module, declaration, name, new Map());
    }
    this.values.set(key, value);
    return value;
  }

  private declarationValue(module: Module, declaration: ts.Node, name: string, scope: Map<string, Value>): Value {
    if (ts.isFunctionDeclaration(declaration)) return new Opaque('function', module.file, name);
    if (ts.isClassDeclaration(declaration)) return new Opaque('class', module.file, name);
    if (ts.isEnumDeclaration(declaration)) return new Opaque('enum', module.file, name);
    if (ts.isVariableDeclaration(declaration)) {
      if (!declaration.initializer) fail(declaration, 'variable without a value');
      return this.evaluate(declaration.initializer, scope);
    }
    return fail(declaration, 'unsupported declaration');
  }

  private moduleOf(node: ts.Node): Module {
    return this.module(node.getSourceFile().fileName);
  }

  /** The value of a name seen from a node: loop variables, local constants, then the module. */
  lookup(name: string, node: ts.Node, scope: Map<string, Value>): Value {
    if (scope.has(name)) return scope.get(name);
    if (name === 'undefined') return undefined;
    for (let parent = node.parent as ts.Node | undefined; parent; parent = parent.parent) {
      if (ts.isSourceFile(parent)) break;
      if (ts.isBlock(parent) || ts.isModuleBlock(parent) || ts.isCaseClause(parent)) {
        const declaration = findDeclaration(parent.statements, name);
        if (declaration) return this.declarationValue(this.moduleOf(node), declaration, name, scope);
      }
      if (ts.isFunctionLike(parent) && parent.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) {
        fail(node, `${name} is a parameter`);
      }
    }
    return this.moduleValue(this.moduleOf(node), name);
  }

  private isExport(value: Value, module: string, name?: string): boolean {
    return value instanceof Opaque && value.module === join(this.root, module) && (name === undefined || value.name === name);
  }

  /** Evaluates an expression of the sources. */
  evaluate(node: ts.Expression, scope: Map<string, Value>): Value {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
      || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)) {
      return this.evaluate(node.expression, scope);
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      const value = this.evaluate(node.operand, scope);
      if (typeof value !== 'number') fail(node, 'not a number');
      return -value;
    }
    if (ts.isIdentifier(node)) return this.lookup(node.text, node, scope);
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) text += this.text(span.expression, scope) + span.literal.text;
      return text;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.evaluate(node.left, scope);
      const right = this.evaluate(node.right, scope);
      if (typeof left === 'number' && typeof right === 'number') return left + right;
      return this.text(node.left, scope) + this.text(node.right, scope);
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.map((element) => {
        if (ts.isSpreadElement(element)) fail(element, 'unsupported spread');
        return this.evaluate(element, scope);
      });
    }
    if (ts.isObjectLiteralExpression(node)) return this.object(node, scope);
    if (ts.isPropertyAccessExpression(node)) return this.property(node, this.evaluate(node.expression, scope), node.name.text);
    if (ts.isElementAccessExpression(node)) {
      const key = this.evaluate(node.argumentExpression, scope);
      if (typeof key !== 'string' && typeof key !== 'number') fail(node, 'unsupported key');
      return this.property(node, this.evaluate(node.expression, scope), String(key));
    }
    if (ts.isNewExpression(node)) return this.construct(node, scope);
    if (ts.isCallExpression(node)) return this.call(node, scope);
    return fail(node, `unsupported expression (${ts.SyntaxKind[node.kind]})`);
  }

  /** An expression that must give a string, a number or a boolean, as a string. */
  private text(node: ts.Expression, scope: Map<string, Value>): string {
    const value = this.evaluate(node, scope);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return fail(node, 'not a string');
  }

  private object(node: ts.ObjectLiteralExpression, scope: Map<string, Value>): Value {
    const result: Record<string, Value> = {};
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = property.name;
        let key: string;
        if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) key = name.text;
        else if (ts.isComputedPropertyName(name)) key = this.text(name.expression, scope);
        else fail(property, 'unsupported property name');
        result[key] = this.evaluate(property.initializer, scope);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        result[property.name.text] = this.lookup(property.name.text, property.name, scope);
      } else if (ts.isSpreadAssignment(property)) {
        const spread = this.evaluate(property.expression, scope);
        if (!isRecord(spread)) fail(property, 'unsupported spread');
        Object.assign(result, spread);
      } else {
        fail(property, 'unsupported property');
      }
    }
    return result;
  }

  private property(node: ts.Node, object: Value, name: string): Value {
    if (this.isExport(object, COLOR_CLASS, 'Color')) {
      const rgba = NAMED_COLORS[name];
      if (rgba) return { rgba: [...rgba] };
    }
    if (this.isExport(object, COLOR_UTILS, 'ColorTransformType')) {
      const op = ENUM_OPS[name];
      if (op) return op;
    }
    if (object instanceof Opaque && object.kind === 'namespace') return this.exported(object.module, name);
    if (Array.isArray(object)) {
      if (!/^\d+$/.test(name)) fail(node, 'unsupported array property');
      return object[Number(name)];
    }
    if (isRecord(object)) return object[name];
    return fail(node, 'unsupported property access');
  }

  private construct(node: ts.NewExpression, scope: Map<string, Value>): Value {
    const callee = this.evaluate(node.expression, scope);
    const args = (node.arguments ?? []).map((arg) => this.evaluate(arg, scope));
    if (this.isExport(callee, COLOR_CLASS, 'RGBA')) {
      const [r, g, b, a = 1] = args;
      if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number' || typeof a !== 'number') fail(node, 'unsupported RGBA');
      // As the constructor of RGBA: channels clamped and truncated, alpha clamped and rounded to 3 decimals
      const channel = (v: number) => Math.min(255, Math.max(0, v)) | 0;
      return { rgba: [channel(r), channel(g), channel(b), Math.round(Math.max(Math.min(1, a), 0) * 1000) / 1000] };
    }
    if (this.isExport(callee, COLOR_CLASS, 'Color')) {
      const [rgba] = args;
      if (!isColorLiteral(rgba)) fail(node, 'unsupported Color');
      return rgba;
    }
    return fail(node, 'unsupported constructor');
  }

  private call(node: ts.CallExpression, scope: Map<string, Value>): Value {
    const arg = (i: number): Value => {
      const expression = node.arguments[i];
      return expression ? this.evaluate(expression, scope) : undefined;
    };
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const object = this.evaluate(callee.expression, scope);
      const method = callee.name.text;
      if (this.isExport(object, COLOR_CLASS, 'Color') && method === 'fromHex') {
        const hex = arg(0);
        if (typeof hex !== 'string') fail(node, 'unsupported Color.fromHex');
        // A string that starts with '#' is read with Color.fromHex when the default is resolved: the same result
        return hex.startsWith('#') ? hex : { rgba: [255, 0, 0, 1] };
      }
      // A method of a Color object, such as Color.black.lighten(0.2): the transform of colorUtils.ts with the same
      // name calls the same method when the default is resolved
      const isColor = isColorLiteral(object) || (typeof object === 'string' && object.startsWith('#'));
      if (isColor && ['lighten', 'darken', 'transparent'].includes(method)) {
        return { op: method, value: object, factor: arg(0) };
      }
      return fail(node, 'unsupported call');
    }
    const fn = this.evaluate(callee, scope);
    if (this.isExport(fn, COLOR_UTILS, 'registerColor')) return arg(0);
    if (fn instanceof Opaque && fn.kind === 'function' && fn.module === join(this.root, COLOR_UTILS)) {
      const op = TRANSFORM_OPS[fn.name];
      if (op === 'oneOf') return { op, values: node.arguments.map((_, i) => arg(i)) };
      const fields = TRANSFORMS[fn.name];
      if (op && fields) return Object.fromEntries([['op', op], ...fields.map((field, i) => [field, arg(i)])]) as Transform;
    }
    return fail(node, 'unsupported call');
  }
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Opaque);
}

function isColorLiteral(value: Value): value is ColorLiteral {
  return isRecord(value) && Array.isArray(value.rgba) && Object.keys(value).length === 1;
}

function hasExport(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function declaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((d) => ts.isIdentifier(d.name) ? [d.name.text] : []);
  }
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
    return [statement.name.text];
  }
  return [];
}

function findDeclaration(statements: ts.NodeArray<ts.Statement>, name: string): ts.Node | undefined {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name);
      if (declaration) return declaration;
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement))
      && statement.name?.text === name) {
      return statement;
    }
  }
  return undefined;
}

/** Names used as values in a file (not only in types), the test TypeScript uses to keep an import. */
function valueIdentifiers(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isHeritageClause(node)) {
      // `extends` of a class is a value; `implements`, and `extends` of an interface, are types
      if (node.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent)) {
        for (const type of node.types) visit(type.expression);
      }
      return;
    }
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) names.add(node.text);
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** A registerColor call, with the loops around it that change its arguments. */
interface Registration { id: string; defaults: Value; file: string }

function registrations(sources: Sources, module: Module): Registration[] {
  const found: Registration[] = [];
  const evaluateCall = (call: ts.CallExpression, scope: Map<string, Value>) => {
    const [idArg, defaultsArg] = call.arguments;
    if (!idArg) fail(call, 'registerColor without arguments');
    const id = sources.evaluate(idArg, scope);
    if (typeof id !== 'string') fail(call, 'the id is not a string');
    const defaults = defaultsArg ? sources.evaluate(defaultsArg, scope) : undefined;
    found.push({ id, defaults, file: sources.path(module.file) });
  };
  // Runs a call once for each iteration of the loops around it, outermost first
  const iterate = (call: ts.CallExpression, loops: (ts.ForInStatement | ts.ForOfStatement)[], scope: Map<string, Value>) => {
    const [loop, ...inner] = loops;
    if (!loop) {
      evaluateCall(call, scope);
      return;
    }
    const declarations = ts.isVariableDeclarationList(loop.initializer) ? loop.initializer.declarations : undefined;
    const variable = declarations?.[0]?.name;
    if (!variable || !ts.isIdentifier(variable)) fail(loop, 'unsupported loop variable');
    const collection = sources.evaluate(loop.expression, scope);
    let items: Value[];
    if (ts.isForInStatement(loop) && isRecord(collection)) items = Object.keys(collection);
    else if (ts.isForOfStatement(loop) && Array.isArray(collection)) items = collection;
    else fail(loop, 'unsupported loop');
    for (const item of items) iterate(call, inner, new Map([...scope, [variable.text, item]]));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'registerColor') {
        let value: Value;
        try {
          value = sources.lookup('registerColor', callee, new Map());
        } catch {
          value = undefined;
        }
        if (value instanceof Opaque && value.module === join(sources.root, COLOR_UTILS) && value.name === 'registerColor') {
          const loops: (ts.ForInStatement | ts.ForOfStatement)[] = [];
          for (let parent = node.parent as ts.Node | undefined; parent; parent = parent.parent) {
            if (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) loops.unshift(parent);
            else if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isForStatement(parent) || ts.isWhileStatement(parent)) {
              fail(node, 'registerColor under a condition or a loop that the script does not follow');
            }
          }
          iterate(node, loops, new Map());
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(module.source);
  return found;
}

/** The defaults of a color for each theme type, as VS Code reads them (resolveDefaultColor of colorUtils.ts). */
function byType(defaults: Value): Record<(typeof THEME_TYPES)[number], Value> {
  // isColorDefaults: an object with `light` and `dark`; otherwise the same value for every type
  if (isRecord(defaults) && 'light' in defaults && 'dark' in defaults) {
    return { light: defaults.light, dark: defaults.dark, hcDark: defaults.hcDark, hcLight: defaults.hcLight };
  }
  return { light: defaults, dark: defaults, hcDark: defaults, hcLight: defaults };
}

/** Checks that a default only holds what the package can resolve, and writes it as data. */
function data(value: Value, id: string): unknown {
  // `if (colorDesc?.defaults)` and resolveColorValue: null, undefined and '' give no color
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  if (isColorLiteral(value)) {
    // Written as '#RRGGBB' or '#RRGGBBAA' when Color.fromHex gives back exactly the same color
    const [r, g, b, a] = value.rgba;
    const alpha = Math.round(a * 255);
    if (Math.round(alpha / 255 * 1000) / 1000 !== a) return value;
    const hex = [r, g, b, ...(alpha === 255 ? [] : [alpha])].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
    return `#${hex}`;
  }
  if (isRecord(value) && typeof value.op === 'string') {
    const op = value.op;
    const fields: Record<string, readonly string[]> = {
      ...TRANSFORMS, opacity: ['value', 'opacity'], mix: ['color', 'with', 'ratio'], oneOf: ['values'],
    };
    const names = fields[op === 'opacity' ? 'withOpacity' : op];
    if (!names) throw new Error(`${id}: unknown transform ${op}`);
    const result: Record<string, unknown> = { op };
    for (const name of names) {
      const field = value[name];
      if (name === 'factor' || name === 'opacity' || name === 'transparency' || name === 'ratio') {
        if (field === undefined && name === 'ratio') continue;
        if (typeof field !== 'number') throw new Error(`${id}: ${op}.${name} is not a number`);
        result[name] = field;
      } else if (name === 'values') {
        if (!Array.isArray(field)) throw new Error(`${id}: oneOf without values`);
        result[name] = field.map((v) => data(v, id));
      } else if (name === 'if') {
        if (typeof field !== 'string') throw new Error(`${id}: ifDefinedThenElse needs a color id`);
        result[name] = field;
      } else {
        result[name] = data(field, id);
      }
    }
    return result;
  }
  throw new Error(`${id}: unsupported default ${JSON.stringify(value)}`);
}

/** Colors contributed by the built-in extensions (colorExtensionPoint.ts). */
function extensionColors(root: string): { id: string; defaults: Record<string, unknown>; file: string }[] {
  const found: { id: string; defaults: Record<string, unknown>; file: string }[] = [];
  const folders = readdirSync(join(root, 'extensions')).sort();
  for (const folder of folders) {
    const file = join(root, 'extensions', folder, 'package.json');
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { contributes?: { colors?: { id: string; defaults: Record<string, string | undefined> }[] } };
    for (const color of manifest.contributes?.colors ?? []) {
      const d = color.defaults;
      const value = (s: string | undefined): unknown => {
        if (s === undefined || s.length === 0) return { rgba: [255, 0, 0, 1] };
        // parseHex: an invalid hexadecimal color gives no color here, not red
        if (s.startsWith('#')) return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? s : null;
        return s;
      };
      found.push({
        id: color.id,
        defaults: { light: value(d.light), dark: value(d.dark), hcDark: value(d.highContrast ?? d.dark), hcLight: value(d.highContrastLight ?? d.light) },
        file: relative(root, file),
      });
    }
  }
  return found;
}

/** A default written as TypeScript, with single quotes. Ids and colors only hold letters, digits and `#._+-`. */
function format(value: unknown): string {
  const check = (v: unknown): void => {
    if (typeof v === 'string' && !/^[\w#.+-]*$/.test(v)) throw new Error(`unexpected text in a default: ${v}`);
    if (typeof v === 'object' && v !== null) Object.values(v).forEach(check);
  };
  check(value);
  return JSON.stringify(value).replace(/"([A-Za-z]+)":/g, '$1: ').replace(/,/g, ', ').replace(/"/g, "'");
}

function main(args: string[]): void {
  const [checkout, output = resolve(import.meta.dirname, '../src/vscode-colors.ts')] = args;
  if (!checkout) {
    process.stderr.write('Usage: node scripts/vscode-colors.ts <VS Code checkout> [output file]\n');
    process.exit(2);
  }
  const root = resolve(checkout);
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

  const sources = new Sources(root);
  sources.load(join(root, ENTRY));
  const all: Registration[] = [];
  for (const file of sources.order) all.push(...registrations(sources, sources.module(file)));

  // A color registered twice keeps its last defaults (colorsById[id] = ...)
  const colors = new Map<string, { defaults: Record<string, unknown>; file: string }>();
  const duplicates: string[] = [];
  for (const { id, defaults, file } of all) {
    if (!/^[\w#.+-]+$/.test(id)) throw new Error(`unexpected color id: ${id}`);
    if (colors.has(id)) duplicates.push(`${id} (${colors.get(id)?.file ?? ''}, then ${file})`);
    const types = byType(defaults);
    colors.set(id, { defaults: Object.fromEntries(THEME_TYPES.map((type) => [type, data(types[type], id)])), file });
  }
  for (const { id, defaults, file } of extensionColors(root)) {
    if (colors.has(id)) duplicates.push(`${id} (${colors.get(id)?.file ?? ''}, then ${file})`);
    colors.set(id, { defaults, file });
  }

  // Files that register colors but that the desktop workbench does not load
  const loaded = new Set(sources.order.map((file) => sources.path(file)));
  const grep = execFileSync('git', ['-C', root, 'grep', '-l', 'registerColor(', '--', 'src/vs/*.ts'], { encoding: 'utf8' });
  const notLoaded = grep.split('\n').filter((file) => file && !loaded.has(file) && !file.includes('/test/') && file !== COLOR_UTILS);

  const lines = [...colors.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, { defaults }]) => {
    const values = THEME_TYPES.map((type) => defaults[type]);
    const same = values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]));
    return `  '${id}': ${same ? format(values[0]) : format(defaults)},`;
  });
  const text = `// Generated by scripts/vscode-colors.ts from microsoft/vscode ${commit.slice(0, 10)} (${version}): do not edit.
// The default of each workbench color, for the four theme types (light, dark, hcDark, hcLight) or one value for all:
// a color ('#RRGGBB'...), the id of another color, or a transform of colorUtils.ts.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: see THIRD-PARTY-NOTICES.md.

import type { ColorRegistry } from './colors.ts';

/** The VS Code sources that the defaults come from. */
export const VSCODE_SOURCE = { version: '${version}', commit: '${commit}' } as const;

export const VSCODE_COLORS: ColorRegistry = {
${lines.join('\n')}
};
`;
  writeFileSync(output, text);
  const report = [
    `VS Code ${version} (${commit})`,
    `${String(sources.order.length)} modules loaded, ${String(all.length)} calls of registerColor, ${String(colors.size)} colors written to ${relative(process.cwd(), output)}`,
    `Registered twice: ${duplicates.length > 0 ? duplicates.join(', ') : 'none'}`,
    `Not loaded by the desktop workbench: ${notLoaded.length > 0 ? notLoaded.join(', ') : 'none'}`,
  ];
  process.stdout.write(report.join('\n') + '\n');
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof EvaluationError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
