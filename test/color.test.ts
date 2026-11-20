// The measuring tools checked against published reference values (sources in test/data/README.md).
// Ported from scripts/themes/tests/test_colorlib.py of 365 Day & Night.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { contrast, linear, over, parse, roundHalfEven } from '../src/color.ts';
import { ciede2000, deltaE, deltaE2000, lab } from '../src/difference.ts';
import type { Lab } from '../src/difference.ts';
import { ACHROMATOPSIA, BRETTEL, MACHADO, MODELS, VIENOT, VIEWS, project, simulate } from '../src/simulation.ts';
import type { Matrix, Simulation } from '../src/simulation.ts';

const data = (name: string) => readFileSync(new URL(`data/${name}`, import.meta.url), 'utf8');

function near(actual: number, expected: number, delta: number, message?: string) {
  assert.ok(Math.abs(actual - expected) <= delta, `${message ?? ''} ${String(actual)} is not within ${String(delta)} of ${String(expected)}`);
}

describe('WCAG 2 contrast ratio: (L1 + 0.05) / (L2 + 0.05), with the relative luminance of sRGB', () => {
  test('extremes', () => {
    near(contrast('#000000', '#FFFFFF'), 21, 1e-6);
    near(contrast('#7F7F7F', '#7F7F7F'), 1, 1e-6);
  });

  test('the order does not matter', () => {
    near(contrast('#1565C0', '#FAFCFF'), contrast('#FAFCFF', '#1565C0'), 1e-9);
  });

  test('#767676 is the lightest gray that passes AA on white', () => {
    // 4.54:1 is the value usually quoted; #777777, just lighter, fails (4.48:1)
    assert.equal(contrast('#767676', '#FFFFFF').toFixed(2), '4.54');
    assert.ok(contrast('#767676', '#FFFFFF') >= 4.5);
    assert.equal(contrast('#777777', '#FFFFFF').toFixed(2), '4.48');
    assert.ok(contrast('#777777', '#FFFFFF') < 4.5);
  });

  test('primary colors', () => {
    // Relative luminance of the sRGB primaries: 0.2126 (red), 0.7152 (green), 0.0722 (blue)
    near(contrast('#FF0000', '#000000'), (0.2126 + 0.05) / 0.05, 1e-4);
    near(contrast('#00FF00', '#000000'), (0.7152 + 0.05) / 0.05, 1e-4);
    near(contrast('#0000FF', '#000000'), (0.0722 + 0.05) / 0.05, 1e-4);
  });
});

describe('colors as written in a theme', () => {
  test('the four hexadecimal forms of VS Code', () => {
    assert.deepEqual(parse('#fff'), { rgb: [1, 1, 1], alpha: 1 });
    assert.deepEqual(parse('#0000'), { rgb: [0, 0, 0], alpha: 0 });
    assert.deepEqual(parse('#FF8000'), { rgb: [1, 128 / 255, 0], alpha: 1 });
    assert.deepEqual(parse('#FF800080'), { rgb: [1, 128 / 255, 0], alpha: 128 / 255 });
  });

  test('anything else is refused', () => {
    for (const color of ['', 'FF8000', '#FF', '#FF80F', '#FF80001', 'red', '#GG8000']) {
      assert.throws(() => parse(color), /Not a color/, color);
    }
  });

  test('a transparent color is composed on its background', () => {
    assert.equal(over('#FF000000', '#123456'), '#123456');
    assert.equal(over('#FF0000FF', '#123456'), '#FF0000');
    assert.equal(over('#FFFFFF80', '#000000'), '#808080');
  });

  test('halfway values are rounded to the even neighbor, like Python', () => {
    assert.deepEqual([0.5, 1.5, 2.5, 3.5, 2.4, 2.6, 254.5].map(roundHalfEven), [0, 2, 2, 4, 2, 3, 254]);
  });
});

describe('CIEDE2000: the 34 test pairs of Sharma, Wu and Dalal (2005), to four decimals', () => {
  const rows = data('sharma2005-ciede2000.txt').split('\n').filter((line) => line.trim())
    .map((line) => line.trim().split(/\s+/).map(Number));

  test('all pairs', () => {
    assert.equal(rows.length, 34);
    rows.forEach((row, i) => {
      const expected = row[6] ?? NaN;
      near(ciede2000(row.slice(0, 3) as unknown as Lab, row.slice(3, 6) as unknown as Lab), expected, 5e-5, `pair ${String(i + 1)}`);
    });
  });

  test('symmetry', () => {
    for (const row of rows) {
      const a = row.slice(0, 3) as unknown as Lab;
      const b = row.slice(3, 6) as unknown as Lab;
      near(ciede2000(a, b), ciede2000(b, a), 1e-9);
    }
  });

  test('identical colors', () => {
    assert.equal(deltaE2000('#3B2718', '#3B2718'), 0);
  });
});

describe('Machado, Oliveira and Fernandes (2009): the published matrices', () => {
  const published = JSON.parse(data('machado2009-cvd.json')) as Record<string, Record<string, number[][]>>;

  test('the matrices are those of severity 1.0, the dichromacies', () => {
    for (const name of ['protan', 'deutan', 'tritan'] as const) {
      assert.deepEqual(MACHADO[name], published['1.0']?.[name]);
    }
  });

  test('the published table is complete', () => {
    assert.deepEqual(Object.keys(published).sort(), Array.from({ length: 11 }, (_, s) => (s / 10).toFixed(1)));
    for (const name of ['protan', 'deutan', 'tritan']) {
      assert.deepEqual(published['0.0']?.[name]?.map((row) => row.map(Math.abs)), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    }
  });

  test('white and gray stay neutral', () => {
    // Each row of a published matrix adds up to about 1: white and grays do not change
    for (const matrices of Object.values(published)) {
      for (const matrix of Object.values(matrices)) {
        for (const row of matrix) near(row.reduce((sum, x) => sum + x, 0), 1, 0.002);
      }
    }
    for (const matrix of Object.values(MACHADO)) {
      assert.ok(deltaE('#808080', '#808080', matrix) < 0.01);
      assert.ok(deltaE('#FFFFFF', '#FFFFFF', matrix) < 0.01);
    }
  });

  test('red and green merge for red-green deficiencies', () => {
    // A red-orange and a green on the same confusion line: far apart in normal vision (ΔE 72), close with
    // protanopia and deuteranopia (ΔE 12), still apart with tritanopia
    const red = '#CA502B';
    const green = '#5E7F2B';
    assert.ok(deltaE(red, green) > 40);
    assert.ok(deltaE(red, green, MACHADO.protan) < 15);
    assert.ok(deltaE(red, green, MACHADO.deutan) < 15);
    assert.ok(deltaE(red, green, MACHADO.tritan) > 30);
  });
});

describe('Brettel 1997 and Viénot 1999 give the colors computed by DaltonLens, for 216 colors', () => {
  const reference = JSON.parse(data('daltonlens-cvd.json')) as Record<string, unknown> & { input: string[] };

  test('same colors as DaltonLens', () => {
    assert.equal(reference.input.length, 216);
    for (const [model, simulations] of [['Brettel 1997', BRETTEL], ['Viénot 1999', VIENOT]] as const) {
      const expected = reference[model] as Record<string, number[][]>;
      assert.deepEqual(Object.keys(expected).sort(), Object.keys(simulations).sort());
      for (const [deficiency, outputs] of Object.entries(expected)) {
        const simulation = (simulations as Record<string, Simulation>)[deficiency];
        assert.ok(simulation);
        reference.input.forEach((color, i) => {
          const [r, g, b] = parse(color).rgb;
          const got = project([linear(r), linear(g), linear(b)], simulation);
          got.forEach((x, k) => { near(x, outputs[i]?.[k] ?? NaN, 1e-9, `${model} ${deficiency} ${color}`); });
        });
      }
    }
  });

  test('models kept for each deficiency', () => {
    // 365 Day & Night, issue #96: Machado and Viénot are not reliable for tritanopia
    assert.deepEqual(Object.keys(MODELS).sort(), ['deutan', 'protan', 'tritan']);
    for (const name of ['protan', 'deutan'] as const) {
      assert.deepEqual(Object.keys(MODELS[name]).sort(), ['Brettel 1997', 'Machado 2009', 'Viénot 1999']);
    }
    assert.deepEqual(Object.keys(MODELS.tritan), ['Brettel 1997']);
    assert.deepEqual(Object.keys(VIEWS), ['normal', 'protan', 'deutan', 'tritan']);
  });

  test('white and grays are unchanged', () => {
    for (const models of Object.values(MODELS)) {
      for (const simulation of Object.values(models)) {
        for (const gray of ['#000000', '#808080', '#FFFFFF']) assert.equal(simulate(gray, simulation), gray);
      }
    }
  });

  test('tritanopia merges yellow-green and lavender', () => {
    // Keyword and class of December High Contrast Dark in 365 Day & Night 1.0.5: far apart in normal vision, almost
    // the same color with tritanopia according to Brettel, while Machado keeps them apart
    const lime = '#A4E05C';
    const lavender = '#C1CDFC';
    assert.ok(deltaE(lime, lavender) > 40);
    assert.ok(deltaE(lime, lavender, BRETTEL.tritan) < 2);
    assert.ok(deltaE(lime, lavender, MACHADO.tritan) > 10);
  });
});

describe('simulated colors', () => {
  test('grays are unchanged', () => {
    for (const matrix of Object.values(MACHADO)) assert.equal(simulate('#808080', matrix), '#808080');
  });

  test('distances use the simulated color rounded to 8 bits, the one shown on screen', () => {
    const simulations: Simulation[] = [...Object.values(MODELS).flatMap((models) => Object.values(models)), ACHROMATOPSIA];
    for (const simulation of simulations) {
      for (const color of ['#C0392B', '#2ECC71', '#2980B9']) {
        assert.deepEqual(lab(color, simulation), lab(simulate(color, simulation)));
      }
    }
  });
});

describe('achromatopsia: without color, only lightness remains', () => {
  test('colors become gray', () => {
    for (const color of ['#B13F0B', '#1565C0', '#2E7D32', '#FFD700']) {
      const [lightness, a, b] = lab(color, ACHROMATOPSIA);
      assert.ok(Math.abs(a) < 0.05 && Math.abs(b) < 0.05, color);
      // The simulated gray is rounded to 8 bits, like on screen: its lightness moves by half a step at most
      near(lightness, lab(color)[0], 0.25, color);
    }
  });

  test('only lightness differences remain', () => {
    const red = '#B5443D';
    const green = '#5E7F2B';
    near(deltaE(red, green, ACHROMATOPSIA), Math.abs(lab(red)[0] - lab(green)[0]), 0.1);
  });

  test('the matrix gives the same gray on the three channels', () => {
    const rows: Matrix = ACHROMATOPSIA;
    assert.deepEqual(rows[0], rows[1]);
    assert.deepEqual(rows[1], rows[2]);
  });
});
