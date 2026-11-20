// Colors as written in a VS Code theme, WCAG 2 contrast and alpha compositing.
// Ported from colorlib.py of 365 Day & Night, with the same results.

/** Red, green and blue, from 0 to 1. */
export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Rounds like Python's round(): a value exactly halfway goes to the even neighbor.
 * Used wherever colorlib.py rounds, so that both give the same 8-bit colors.
 */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** '#RGB', '#RGBA', '#RRGGBB' or '#RRGGBBAA' -> red, green and blue from 0 to 1, and alpha from 0 to 1. */
export function parse(color: string): { rgb: Rgb; alpha: number } {
  const match = HEX.exec(color);
  if (!match?.[1]) throw new Error(`Not a color: ${color}`);
  let hex = match[1];
  if (hex.length <= 4) hex = hex.replace(/./g, '$&$&');
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { rgb: [channel(0), channel(2), channel(4)], alpha: hex.length === 8 ? channel(6) : 1 };
}

/** Red, green and blue from 0 to 1 -> '#RRGGBB'. */
export function toHex(rgb: Rgb): string {
  return '#' + rgb.map((v) => roundHalfEven(v * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** A color, with or without alpha, as it appears on an opaque background. */
export function over(color: string, background: string): string {
  const { rgb, alpha } = parse(color);
  const { rgb: back } = parse(background);
  return toHex([0, 1, 2].map((i) => alpha * (rgb[i] ?? 0) + (1 - alpha) * (back[i] ?? 0)) as unknown as Rgb);
}

/** sRGB channel -> linear RGB. */
export function linear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Linear RGB channel -> sRGB. */
export function gamma(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** Relative luminance of WCAG 2. The alpha of the color is ignored. */
export function luminance(color: string): number {
  const [r, g, b] = parse(color).rgb;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio between two opaque colors, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}
