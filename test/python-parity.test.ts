// The TypeScript port gives the results of colorlib.py of 365 Day & Night (test/data/colorlib-reference.json):
// the same 8-bit colors, and the same numbers to 1e-9.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { contrast, over } from '../src/color.ts';
import { deltaE, deltaE2000, lab } from '../src/difference.ts';
import { ACHROMATOPSIA, MODELS, simulate } from '../src/simulation.ts';
import type { Simulation } from '../src/simulation.ts';

interface Reference {
  colors: string[];
  lab: number[][];
  simulate: Record<string, string[]>;
  pairs: [string, string][];
  contrast: number[];
  deltaE: number[];
  deltaE2000: Record<string, number[]>;
  over: [string, string, string][];
}

const reference = JSON.parse(readFileSync(new URL('data/colorlib-reference.json', import.meta.url), 'utf8')) as Reference;

const simulations = new Map<string, Simulation | null>([['normal', null]]);
for (const [deficiency, models] of Object.entries(MODELS)) {
  for (const [model, simulation] of Object.entries(models)) simulations.set(`${model} ${deficiency}`, simulation);
}
simulations.set('achromatopsia', ACHROMATOPSIA);

function near(actual: number, expected: number | undefined, label: string) {
  assert.ok(expected !== undefined && Math.abs(actual - expected) <= 1e-9, `${label}: ${String(actual)} instead of ${String(expected)}`);
}

test('the reference covers every simulation of the audit', () => {
  assert.deepEqual(Object.keys(reference.simulate).sort(), [...simulations.keys()].filter((n) => n !== 'normal').sort());
  assert.deepEqual(Object.keys(reference.deltaE2000).sort(), [...simulations.keys()].sort());
  assert.equal(reference.colors.length, 232);
});

test('same CIELAB values', () => {
  reference.colors.forEach((color, i) => {
    lab(color).forEach((value, k) => { near(value, reference.lab[i]?.[k], `lab ${color}`); });
  });
});

test('same simulated colors, rounded to 8 bits', () => {
  for (const [name, expected] of Object.entries(reference.simulate)) {
    const simulation = simulations.get(name);
    assert.ok(simulation);
    assert.deepEqual(reference.colors.map((color) => simulate(color, simulation)), expected, name);
  }
});

test('same contrast and CIE76 values', () => {
  reference.pairs.forEach(([a, b], i) => {
    near(contrast(a, b), reference.contrast[i], `contrast ${a} ${b}`);
    near(deltaE(a, b), reference.deltaE[i], `deltaE ${a} ${b}`);
  });
});

test('same CIEDE2000 values, in every vision', () => {
  for (const [name, expected] of Object.entries(reference.deltaE2000)) {
    const simulation = simulations.get(name) ?? null;
    reference.pairs.forEach(([a, b], i) => { near(deltaE2000(a, b, simulation), expected[i], `${name} ${a} ${b}`); });
  }
});

test('same colors once composed on a background', () => {
  assert.ok(reference.over.length > 100);
  for (const [color, background, expected] of reference.over) assert.equal(over(color, background), expected, `${color} on ${background}`);
});
