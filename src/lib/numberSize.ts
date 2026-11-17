export const DEFAULT_NUMBER_SIZE = 18;
export const MIN_NUMBER_SIZE = DEFAULT_NUMBER_SIZE - 7;
export const MAX_NUMBER_SIZE = DEFAULT_NUMBER_SIZE + 7;
export const NUMBER_FONT = 'Helvetica Neue, Segoe UI, Arial, sans-serif';

/** Scale with usable interior area, then fit the complete number inside it. */
export function relativeNumberSize(
  baseSize: number,
  width: number,
  height: number,
  digits: number,
): number {
  const base = Math.max(MIN_NUMBER_SIZE, Math.min(MAX_NUMBER_SIZE, baseSize));
  const relative = (base * Math.sqrt(Math.max(0, width * height))) / (DEFAULT_NUMBER_SIZE * 3);
  const target = Math.max(MIN_NUMBER_SIZE, Math.min(MAX_NUMBER_SIZE, relative));
  return Math.max(1, Math.min(target, (width * 0.8) / (Math.max(1, digits) * 0.56), height * 0.8));
}
