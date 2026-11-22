// A sample for the check with Inspect Editor Tokens and Scopes
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/** A shape with a name. */
interface Shape {
  readonly name: string;
  area(): number;
}

type Unit = 'cm' | 'in';
const LIMIT = 42;
let count = 0x1f;

export class Circle implements Shape {
  static readonly unit: Unit = 'cm';
  readonly name = `circle ${LIMIT}`;

  constructor(private radius: number) {}

  area(): number {
    count += 1;
    return Math.PI * this.radius ** 2;
  }
}

async function load(file: string): Promise<string[]> {
  const text = readFileSync(path.join('.', file), 'utf8');
  return text.split(/\r?\n/).filter((line) => line !== '');
}

if (count > LIMIT && new Circle(2).area() < 10) {
  console.log(load('a.txt'), true, null, undefined);
}
