// Color blindness simulations, in linear RGB, and the models that the audit trusts for each deficiency.
// Ported from colorlib.py of 365 Day & Night, with the same results.

import { gamma, linear, parse, toHex } from './color.ts';
import type { Rgb } from './color.ts';

export type Matrix = readonly [Rgb, Rgb, Rgb];

/** Brettel 1997: two half-planes, and the normal of the plane that separates them. */
export interface HalfPlanes {
  readonly plane1: Matrix;
  readonly plane2: Matrix;
  readonly separation: Rgb;
}

export type Simulation = Matrix | HalfPlanes;
export type Deficiency = 'protan' | 'deutan' | 'tritan';

/**
 * Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for Simulation of Color Vision Deficiency",
 * IEEE TVCG 15(6), p. 1291-1298. Published matrices for severity 1.0, in linear RGB.
 */
export const MACHADO: Readonly<Record<Deficiency, Matrix>> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};

/**
 * Viénot, Brettel and Mollon (1999), "Digital video colourmaps for checking the legibility of displays by dichromats",
 * Color Research & Application 24(4), p. 243-252. One projection per deficiency, valid for protanopia and
 * deuteranopia only. Matrices in linear RGB, computed by DaltonLens 0.1.5 (LMS model of Smith and Pokorny adapted to
 * sRGB) and checked against its results (test/data/daltonlens-cvd.json).
 */
export const VIENOT: Readonly<Record<'protan' | 'deutan', Matrix>> = {
  protan: [[0.1088893110253553, 0.8911106889746441, 0.0], [0.10888931102535536, 0.8911106889746446, 0.0],
    [0.004471314172181988, -0.004471314172181949, 1.0]],
  deutan: [[0.2903053212655528, 0.7096946787344469, 0.0], [0.29030532126555286, 0.7096946787344469, 0.0],
    [-0.02197353944733135, 0.021973539447331363, 1.0]],
};

/**
 * Brettel, Viénot and Mollon (1997), "Computerized simulation of color appearance for dichromats", JOSA A 14(10),
 * p. 2647-2655. A color is projected on the first or the second half-plane, depending on its side of the separation
 * plane. The only one of the three models that is reliable for tritanopia. Computed like VIENOT.
 */
export const BRETTEL: Readonly<Record<Deficiency, HalfPlanes>> = {
  protan: {
    plane1: [[0.14509618931338164, 1.2016532157622424, -0.34674940507562363],
      [0.10446500989201518, 0.8531639308397114, 0.04237105926827329],
      [0.0042896394038027625, -0.006029519250709631, 1.0017398798469068]],
    plane2: [[0.1411517215232287, 1.1678219369471488, -0.30897365847037833],
      [0.10494700431240045, 0.8572979454877919, 0.0377550501998077],
      [0.004309431507017369, -0.005859764495996709, 1.0015503329889792]],
    separation: [0.00048454953529869423, 0.004155929595708196, -0.0046404791310068905],
  },
  deutan: {
    plane1: [[0.36198239320435854, 0.8675466622532473, -0.2295290554576064],
      [0.2609853389970158, 0.6451242766151196, 0.0938903843878646],
      [-0.01975427669264204, 0.026860946512120308, 0.9928933301805217]],
    plane2: [[0.37009000982854123, 0.8854017912522372, -0.25549180108077885],
      [0.2576688645759613, 0.6378205175260239, 0.10451061789801484],
      [-0.019503248977409616, 0.02741377633197485, 0.9920894726454347]],
    separation: [-0.0029279800414292994, -0.006448191098510094, 0.009376171139939394],
  },
  tritan: {
    plane1: [[1.0135416153085874, 0.14268231071503093, -0.1562239260236198],
      [-0.01180536477256513, 0.8756118316612331, 0.1361935331113322],
      [0.07707253450633182, 0.812080912463489, 0.11084655303017935]],
    plane2: [[0.9333697629350477, 0.19999004994381192, -0.13335981287886017],
      [0.05808718055484977, 0.8256518563946372, 0.11626096305051282],
      [-0.3792281148392172, 1.1382497341689028, 0.24097838067031496]],
    separation: [0.03960095072164182, -0.028307203712766432, -0.011293747008875398],
  },
};

/**
 * Models kept for each deficiency (365 Day & Night, issue #96): a pair of colors must stay distinct with each of them.
 * Machado 2009 and Viénot 1999 are not reliable for tritanopia.
 */
export const MODELS: Readonly<Record<Deficiency, Readonly<Record<string, Simulation>>>> = {
  protan: { 'Machado 2009': MACHADO.protan, 'Brettel 1997': BRETTEL.protan, 'Viénot 1999': VIENOT.protan },
  deutan: { 'Machado 2009': MACHADO.deutan, 'Brettel 1997': BRETTEL.deutan, 'Viénot 1999': VIENOT.deutan },
  tritan: { 'Brettel 1997': BRETTEL.tritan },
};

export type View = 'normal' | Deficiency;

/** Normal vision and the 3 dichromacies, each with its models. Normal vision has no model: its name is empty. */
export const VIEWS: Readonly<Record<View, Readonly<Record<string, Simulation | null>>>> = {
  normal: { '': null },
  ...MODELS,
};

/** Every simulation to check, normal vision (null) included. */
export const SIMULATIONS: readonly (Simulation | null)[] = Object.values(VIEWS).flatMap((models) => Object.values(models));

/**
 * Achromatopsia (no color vision): each color becomes the gray of the same luminance (CIE Y, sRGB coefficients).
 * An approximation: people with achromatopsia see with rods, whose sensitivity makes blue a little lighter and red
 * darker. Only lightness differences remain.
 */
export const ACHROMATOPSIA: Matrix = [[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]];

function isHalfPlanes(simulation: Simulation): simulation is HalfPlanes {
  return 'separation' in simulation;
}

function apply(matrix: Matrix, v: Rgb): Rgb {
  return matrix.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as unknown as Rgb;
}

/** Applies a simulation to a color in linear RGB, without clipping. */
export function project(v: Rgb, simulation: Simulation): Rgb {
  if (isHalfPlanes(simulation)) {
    const [n0, n1, n2] = simulation.separation;
    const side = n0 * v[0] + n1 * v[1] + n2 * v[2];
    return apply(side < 0 ? simulation.plane2 : simulation.plane1, v);
  }
  return apply(simulation, v);
}

/** The color as seen after the simulation: '#RRGGBB' -> '#RRGGBB', rounded to 8 bits like on screen. */
export function simulate(color: string, simulation: Simulation): string {
  const [r, g, b] = parse(color).rgb;
  const projected = project([linear(r), linear(g), linear(b)], simulation);
  return toHex(projected.map((x) => gamma(Math.max(0, Math.min(1, x)))) as unknown as Rgb);
}
