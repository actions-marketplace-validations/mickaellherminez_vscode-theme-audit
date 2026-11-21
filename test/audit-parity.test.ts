// The checks give the results of audit.py and variety.py of 365 Day & Night on its 48 themes, in strict mode (the
// rules of 365): the same checks in the same order, the same pairs, and the same values to 0.01.
// The themes and the results are in test/data/365 and test/data/audit-reference.json (test/data/audit_reference.py).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { auditTheme, auditVariety } from '../src/audit.ts';
import type { Check, Distinction, PairDistance } from '../src/audit.ts';
import { extensionColors } from '../src/colors.ts';
import { loadTheme } from '../src/theme.ts';
import type { UiTheme } from '../src/theme.ts';
import { VSCODE_COLORS } from '../src/vscode-colors.ts';

interface Reference {
  source: string;
  minimumDeltaE2000: number;
  themes: {
    path: string;
    uiTheme: UiTheme;
    checks: Check[];
    distinctions: Distinction[];
    achromatopsia: { pair: [string, string]; deltaE2000: number; cie76: number }[];
  }[];
  variety: {
    uiTheme: UiTheme;
    themes: string[];
    measures: { measure: string; threshold: number | null; pairs: PairDistance[]; meanDeltaE2000: number; colorBlindness: Record<string, PairDistance[]> | null }[];
    families: Record<string, Record<string, string>>;
  }[];
}

const ROOT = join(import.meta.dirname, 'data', '365');
const reference = JSON.parse(readFileSync(join(import.meta.dirname, 'data', 'audit-reference.json'), 'utf8')) as Reference;
const registry = { ...VSCODE_COLORS, ...extensionColors(ROOT).colors };
const TOLERANCE = 0.01;

function near(actual: number | null | undefined, expected: number | null, label: string): void {
  if (expected === null) {
    assert.equal(actual, null, label);
    return;
  }
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= TOLERANCE, `${label}: ${String(actual)} instead of ${String(expected)}`);
}

/** A pair whatever the order of its two names: audit.py orders the syntax categories as the rules of the theme do. */
function pairKey(view: string, pair: readonly string[]): string {
  return `${view}: ${[...pair].sort().join(' / ')}`;
}

test('the reference covers the 48 themes of 365 Day & Night', () => {
  assert.equal(reference.themes.length, 48);
  assert.equal(reference.variety.length, 4);
  assert.match(reference.source, /^365 Day & Night [0-9a-f]{7}/);
});

describe('the checks of audit.py, in strict mode', () => {
  for (const expected of reference.themes) {
    test(expected.path, () => {
      const audit = auditTheme(loadTheme(join(ROOT, expected.path)), expected.uiTheme, { strict: true, registry });

      assert.deepEqual(audit.checks.map((c) => c.label), expected.checks.map((c) => c.label));
      expected.checks.forEach((check, i) => {
        const actual = audit.checks[i];
        assert.equal(actual?.status, check.status, check.label);
        assert.equal(actual.minimum, check.minimum, check.label);
        near(actual.value, check.value, check.label);
      });

      const distinctions = new Map(audit.distinctions.map((d) => [pairKey(d.view, d.pair), d]));
      assert.deepEqual([...distinctions.keys()].sort(), expected.distinctions.map((d) => pairKey(d.view, d.pair)).sort());
      for (const pair of expected.distinctions) {
        const key = pairKey(pair.view, pair.pair);
        const actual = distinctions.get(key);
        near(actual?.deltaE2000, pair.deltaE2000, key);
        near(actual?.cie76, pair.cie76, key);
        assert.equal(actual?.model, pair.model, key);
        assert.equal(actual.status, pair.status, key);
      }

      const grays = new Map(audit.achromatopsia.map((d) => [pairKey('achromatopsia', d.pair), d]));
      assert.equal(grays.size, expected.achromatopsia.length);
      for (const pair of expected.achromatopsia) near(grays.get(pairKey('achromatopsia', pair.pair))?.deltaE2000, pair.deltaE2000, pair.pair.join(' / '));
    });
  }
});

describe('the variety of variety.py', () => {
  const varieties = auditVariety(reference.themes.map((t) => ({ name: t.path, uiTheme: t.uiTheme, theme: loadTheme(join(ROOT, t.path)) })));

  for (const expected of reference.variety) {
    test(expected.uiTheme, () => {
      const actual = varieties.find((v) => v.uiTheme === expected.uiTheme);
      assert.ok(actual);
      assert.deepEqual(actual.themes, expected.themes);
      assert.deepEqual(actual.families, expected.families);
      assert.deepEqual(actual.missing, []);
      assert.deepEqual(actual.measures.map((m) => [m.measure, m.threshold]), expected.measures.map((m) => [m.measure, m.threshold]));
      const comparePairs = (pairs: PairDistance[] | undefined, wanted: PairDistance[], label: string) => {
        assert.deepEqual(pairs?.map((p) => p.themes), wanted.map((p) => p.themes), label);
        wanted.forEach((p, i) => { near(pairs[i]?.deltaE, p.deltaE, `${label} ${p.themes.join(' / ')}`); });
      };
      expected.measures.forEach((measure, i) => {
        const mine = actual.measures[i];
        near(mine?.meanDeltaE2000, measure.meanDeltaE2000, measure.measure);
        comparePairs(mine?.pairs, measure.pairs, measure.measure);
        for (const [view, pairs] of Object.entries(measure.colorBlindness ?? {})) {
          comparePairs(mine?.colorBlindness?.[view as 'protan'], pairs, `${measure.measure} ${view}`);
        }
      });
    });
  }
});
