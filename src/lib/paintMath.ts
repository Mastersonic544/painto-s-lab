// =============================================================
// Painto's Lab — single source of truth for the paint math
// PRD §7: volume_ml = area_cm2 * coats * coverage_factor, with a
// safety margin. Coverage is the one tunable constant; calibrate
// it from real painting and bump as needed.
// =============================================================

/** ml of paint needed per cm² per coat. Calibrate from real painting. */
export const COVERAGE_FACTOR_ML_PER_CM2_PER_COAT = 0.05;

/** Over-estimating means nobody runs out mid-piece (PRD §7). */
export const SAFETY_MARGIN = 1.15;

export interface VolumeInputs {
  areaPercentage: number;
  canvasWidthCm: number;
  canvasHeightCm: number;
  coats: number;
}

/**
 * One color's estimated paint volume in millilitres. Always rounds UP
 * (to the nearest 0.01 ml) so we never under-report.
 */
export function estimateVolumeMl(o: VolumeInputs): number {
  const cm2 = o.areaPercentage * o.canvasWidthCm * o.canvasHeightCm;
  const raw = cm2 * o.coats * COVERAGE_FACTOR_ML_PER_CM2_PER_COAT * SAFETY_MARGIN;
  return roundUpCents(raw);
}

/** Round a value up to the nearest 0.01. */
export function roundUpCents(v: number): number {
  return Math.ceil(v * 100) / 100;
}

// ----- Color distance helpers ---------------------------------

export function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace(/^#/, '').trim();
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return [r, g, b];
}

export function rgbDistance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Tolerance for "near match" between target hex and a verified recipe's
 * hex. Tight enough that swaps are visually similar, loose enough that
 * common rounding drift doesn't force a re-mix.
 */
export const NEAR_MATCH_RGB_TOLERANCE = 8;
