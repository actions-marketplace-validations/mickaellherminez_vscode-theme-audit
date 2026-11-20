// CIELAB and the color differences CIE76 and CIEDE2000, after a simulation or not.
// Ported from colorlib.py of 365 Day & Night, with the same results.

import { linear, parse } from './color.ts';
import { simulate } from './simulation.ts';
import type { Simulation } from './simulation.ts';

export type Lab = readonly [number, number, number];

const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (degreesValue: number) => (degreesValue * Math.PI) / 180;
/** Remainder with the sign of the divisor, like Python's %. */
const modulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

/** Color -> CIE L*a*b* (D65), after a simulation if one is given (the simulated color is rounded to 8 bits). */
export function lab(color: string, simulation: Simulation | null = null): Lab {
  const [r, g, b] = parse(simulation ? simulate(color, simulation) : color).rgb;
  const v = [linear(r), linear(g), linear(b)] as const;
  const x = (0.4124 * v[0] + 0.3576 * v[1] + 0.1805 * v[2]) / 0.95047;
  const y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const z = (0.0193 * v[0] + 0.1192 * v[1] + 0.9505 * v[2]) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Perceived difference CIE76: the distance in CIELAB. */
export function deltaE(a: string, b: string, simulation: Simulation | null = null): number {
  const [l1, a1, b1] = lab(a, simulation);
  const [l2, a2, b2] = lab(b, simulation);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Perceived difference CIEDE2000 between two L*a*b* colors, with kL = kC = kH = 1.
 *
 * Closer to perception than CIE76, especially for blues and low saturation colors, on another scale: a ΔE2000 is
 * usually smaller than the ΔE76 of the same pair. Follows Sharma, Wu and Dalal (2005), "The CIEDE2000 color-difference
 * formula: implementation notes, supplementary test data, and mathematical observations", Color Research &
 * Application 30(1), p. 21-30, and passes their 34 test pairs (test/data/sharma2005-ciede2000.txt).
 */
export function ciede2000(lab1: Lab, lab2: Lab): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const cMean = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = a1p === 0 && b1 === 0 ? 0 : modulo(degrees(Math.atan2(b1, a1p)), 360);
  const h2p = a2p === 0 && b2 === 0 ? 0 : modulo(degrees(Math.atan2(b2, a2p)), 360);

  const deltaL = l2 - l1;
  const deltaC = c2p - c1p;
  let deltaH = 0;
  if (c1p * c2p !== 0) {
    deltaH = h2p - h1p;
    if (deltaH > 180) deltaH -= 360;
    else if (deltaH < -180) deltaH += 360;
  }
  const deltaBigH = 2 * Math.sqrt(c1p * c2p) * Math.sin(radians(deltaH / 2));

  const lMean = (l1 + l2) / 2;
  const cpMean = (c1p + c2p) / 2;
  let hMean: number;
  if (c1p * c2p === 0) hMean = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hMean = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hMean = (h1p + h2p + 360) / 2;
  else hMean = (h1p + h2p - 360) / 2;

  const t = 1 - 0.17 * Math.cos(radians(hMean - 30)) + 0.24 * Math.cos(radians(2 * hMean))
    + 0.32 * Math.cos(radians(3 * hMean + 6)) - 0.20 * Math.cos(radians(4 * hMean - 63));
  const deltaTheta = 30 * Math.exp(-(((hMean - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cpMean ** 7 / (cpMean ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2);
  const sC = 1 + 0.045 * cpMean;
  const sH = 1 + 0.015 * cpMean * t;
  const rT = -Math.sin(radians(2 * deltaTheta)) * rC;
  const dl = deltaL / sL;
  const dc = deltaC / sC;
  const dh = deltaBigH / sH;
  return Math.sqrt(dl ** 2 + dc ** 2 + dh ** 2 + rT * dc * dh);
}

/** Perceived difference CIEDE2000 between two colors, after a simulation if one is given. */
export function deltaE2000(a: string, b: string, simulation: Simulation | null = null): number {
  return ciede2000(lab(a, simulation), lab(b, simulation));
}
