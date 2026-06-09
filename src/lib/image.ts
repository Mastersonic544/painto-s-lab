// Client-side image helpers for intake: crop the bitmap before upload and
// derive the physical canvas size from the cropped pixels.

/** Crop rectangle, normalized 0..1 relative to the source image. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image.'));
    img.src = src;
  });
}

export interface CroppedResult {
  /** The file to upload — re-cut to the crop, or the original if full-frame. */
  file: File;
  /** Pixel dimensions of the (cropped) image, used to derive the canvas size. */
  widthPx: number;
  heightPx: number;
}

/**
 * Re-cut `file` to the normalized crop via a <canvas>, returning the new file
 * plus its pixel dimensions. When the crop is the full frame we skip the
 * re-encode and hand back the original (still decoded to read its dimensions).
 */
export async function cropImageFile(file: File, crop: CropRect): Promise<CroppedResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;

    const isFull =
      crop.x <= 0.001 && crop.y <= 0.001 && crop.w >= 0.999 && crop.h >= 0.999;
    if (isFull) return { file, widthPx: nw, heightPx: nh };

    const sx = Math.round(crop.x * nw);
    const sy = Math.round(crop.y * nh);
    const sw = Math.max(1, Math.round(crop.w * nw));
    const sh = Math.max(1, Math.round(crop.h * nh));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { file, widthPx: nw, heightPx: nh };
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return { file, widthPx: nw, heightPx: nh };

    const base = file.name.replace(/\.[^.]+$/, '');
    const cropped = new File([blob], `${base}-crop.png`, { type: 'image/png' });
    return { file: cropped, widthPx: sw, heightPx: sh };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DPI = 300;

/**
 * Convert pixel dimensions to a physical canvas size in cm, treating the
 * image as a 300 DPI print. Rounded UP, never down (PRD quality-first rule).
 */
export function pxToCanvasCm(widthPx: number, heightPx: number): { w: number; h: number } {
  const toCm = (px: number) => Math.max(1, Math.ceil((px / DPI) * 2.54));
  return { w: toCm(widthPx), h: toCm(heightPx) };
}
