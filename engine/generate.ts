// =============================================================
// Painto's Lab — wrapper around drake7707/paintbynumbersgenerator
// Mirrors the upstream CLI pipeline (see src-cli/main.ts) but
// returns the two SVGs and the palette JSON in-memory instead of
// writing files. The wrapper preserves determinism: a fixed
// randomSeed yields byte-identical output.
// =============================================================

import * as nodeCanvas from 'canvas';
import { ColorReducer } from './src/colorreductionmanagement';
import { FacetBorderSegmenter } from './src/facetBorderSegmenter';
import { FacetBorderTracer } from './src/facetBorderTracer';
import { FacetCreator } from './src/facetCreator';
import { FacetLabelPlacer } from './src/facetLabelPlacer';
import { FacetResult } from './src/facetmanagement';
import { FacetReducer } from './src/facetReducer';
import { Settings, ClusteringColorSpace } from './src/settings';
import type { RGB } from './src/common';

export interface GenerateOptions {
  /** Target color count (k for k-means). Required. */
  colorCount: number;
  /** Seed for k-means initial centroid selection. Fixed → deterministic. */
  randomSeed: number;
  /** Drop facets smaller than this many pixels. PRD §5: keeps numbers fittable. */
  minFacetSize?: number;
  /** Hard cap on facet count (largest-first reduction). */
  maxFacets?: number;
  /** Cap on long edge of input before processing (perf safety). */
  resizeMaxWidth?: number;
  resizeMaxHeight?: number;
  /** Optional palette restrictions so generation favours mixable colors. */
  colorRestrictions?: Array<RGB | string>;
  /** SVG render scale. Default 3, matching the upstream CLI sample. */
  sizeMultiplier?: number;
  /** Label digit color in the outline SVG. */
  fontColor?: string;
  fontSize?: number;
  /** Override narrow-pixel cleanup loop count. Default 3 (engine default). */
  narrowPixelStripCleanupRuns?: number;
  /** k-means color space. LAB separates skin tones / eyes better (portraits). */
  clusteringColorSpace?: 'rgb' | 'hsl' | 'lab';
  /** Contrast multiplier applied before clustering (1 = none, 1.25 = +25%). */
  contrastBoost?: number;
  /** Saturation multiplier applied before clustering (1 = none). */
  saturationBoost?: number;
  /**
   * Portrait edge emphasis, 0..1. Sharpens the image and burns dark contour
   * lines along strong edges (eyes, nose, mouth) before clustering, so the
   * facet engine draws crisp feature outlines instead of smudging them.
   */
  edgeEmphasis?: number;
  renderMode?: string;
  strokeWidth?: number;
  unifiedFontSize?: boolean;
}

// ----- Portrait line-art pre-pass -------------------------------------------
// Extract clean feature contours with Canny, thicken them into solid black
// lines, flatten the colour underneath, then let the facet engine fill between
// the lines. This is what turns a face into "pencil outline + colour" instead
// of a blurry blob of clusters.

function gaussBlur(src: Float32Array, w: number, h: number): Float32Array {
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        s += src[y * w + xx] * k[i + 2];
      }
      tmp[y * w + x] = s / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        s += tmp[yy * w + x] * k[i + 2];
      }
      out[y * w + x] = s / 16;
    }
  }
  return out;
}

function canny(lum: Float32Array, w: number, h: number, lo: number, hi: number): Uint8Array {
  const b = gaussBlur(lum, w, h);
  const mag = new Float32Array(w * h);
  const dir = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1] + b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1];
      const gy = -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1] + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      let ang = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (ang < 0) ang += 180;
      dir[i] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
    }
  }
  // Non-maximum suppression — thin edges to 1px ridges.
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      let p: number;
      let q: number;
      switch (dir[i]) {
        case 0:
          p = mag[i - 1];
          q = mag[i + 1];
          break;
        case 1:
          p = mag[i - w + 1];
          q = mag[i + w - 1];
          break;
        case 2:
          p = mag[i - w];
          q = mag[i + w];
          break;
        default:
          p = mag[i - w - 1];
          q = mag[i + w + 1];
      }
      nms[i] = m >= p && m >= q ? m : 0;
    }
  }
  // Double threshold + hysteresis — keep weak edges joined to strong ones.
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (nms[i] >= hi) {
      out[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!out[j] && nms[j] >= lo) {
          out[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return out;
}

function dilateBin(bin: Uint8Array, w: number, h: number): void {
  const src = bin.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x]) continue;
      let on = false;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (src[ny * w + nx]) {
            on = true;
            break;
          }
        }
      }
      if (on) bin[y * w + x] = 1;
    }
  }
}

// 3x3 median (one pass) — flattens skin/noise while keeping edges SHARP, which
// a box blur would smear. This is what lets the contours come out clean.
function median3(data: Uint8ClampedArray, w: number, h: number): void {
  const src = data.slice();
  const win: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        win.length = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            win.push(src[((y + dy) * w + (x + dx)) * 4 + c]);
          }
        }
        win.sort((a, b) => a - b);
        data[i + c] = win[4];
      }
    }
  }
}

// strength 0..1: higher => lower Canny threshold => more / finer lines.
function portraitLineArt(data: Uint8ClampedArray, w: number, h: number, strength: number): void {
  // Lift shadows (gamma) so dark / backlit faces reveal their internal tones
  // and features instead of clustering into one muddy dark blob.
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, 0.72));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  // Edge-preserving smooth: clean flat fills + crisp feature edges.
  median3(data, w, h);
  median3(data, w, h);
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  // Strong unsharp on luma so SOFT features (eyes/nose/mouth) become detectable
  // edges instead of merging into the surrounding skin.
  const blur = gaussBlur(lum, w, h);
  for (let i = 0; i < n; i++) {
    lum[i] = Math.max(0, Math.min(255, lum[i] + 1.7 * (lum[i] - blur[i])));
  }
  const hi = Math.max(28, 100 - 70 * strength);
  const edges = canny(lum, w, h, hi * 0.4, hi);
  // One dilate → ~3px pencil lines; they stay continuous because portrait mode
  // skips the engine's narrow-strip cleanup (which would erase them).
  dilateBin(edges, w, h);
  for (let i = 0; i < n; i++) {
    if (edges[i]) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
    }
  }
}

const COLOR_SPACE: Record<'rgb' | 'hsl' | 'lab', ClusteringColorSpace> = {
  rgb: ClusteringColorSpace.RGB,
  hsl: ClusteringColorSpace.HSL,
  lab: ClusteringColorSpace.LAB,
};

// Contrast + saturation pre-pass (in place). Portraits get a boost so eyes
// and other small high-contrast features survive clustering instead of being
// averaged into the surrounding skin tone.
function preprocessPixels(data: Uint8ClampedArray, contrast: number, saturation: number): void {
  const c = contrast;
  const s = saturation;
  if (c === 1 && s === 1) return;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (c !== 1) {
      r = (r / 255 - 0.5) * c + 0.5;
      g = (g / 255 - 0.5) * c + 0.5;
      b = (b / 255 - 0.5) * c + 0.5;
      r *= 255;
      g *= 255;
      b *= 255;
    }
    if (s !== 1) {
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      r = luma + (r - luma) * s;
      g = luma + (g - luma) * s;
      b = luma + (b - luma) * s;
    }
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
}

export interface PaletteEntry {
  index: number;
  rgb: [number, number, number];
  hex: string;
  areaPercentage: number;
  frequency: number;
}

export interface GenerateResult {
  filledSvg: string;
  outlineSvg: string;
  palette: PaletteEntry[];
  /** Post-resize dimensions of the processed bitmap. */
  width: number;
  height: number;
  segmentationCache?: unknown;
}

export function calculateMinFacetSize(fontSizeInImageSpace: number, paddingPct: number = 0.05): number {
  const paddingFactor = 1 - 2 * paddingPct; // 0.90 for 5% margin
  const textWidth = 1.2 * fontSizeInImageSpace; // 2-digit width estimate
  const textHeight = fontSizeInImageSpace;
  const area = (textWidth / paddingFactor) * (textHeight / paddingFactor);
  return Math.ceil(area);
}

export function getMinFacetSizeForPiece(
  renderMode: string | undefined,
  fontSize: number,
  sizeMultiplier: number,
  overrideMinFacetSize?: number,
): number {
  if (renderMode === 'exact_source') {
    return 1; // Bypass small chunk pruning in exact source mode
  }
  if (overrideMinFacetSize !== undefined) {
    return overrideMinFacetSize;
  }
  const fontSizeInImageSpace = fontSize / sizeMultiplier;
  const baseArea = calculateMinFacetSize(fontSizeInImageSpace, 0.05);
  // Apply a shape safety factor (1.5 for portrait, 2.5 for standard painting)
  // to ensure irregular curved facets are large enough to paint/contain text.
  const multiplier = renderMode === 'portrait' ? 1.5 : 2.5;
  return Math.ceil(baseArea * multiplier);
}

export async function generatePaintByNumbers(
  imageBuffer: Buffer,
  options: GenerateOptions,
): Promise<GenerateResult> {
  if (!options || typeof options.colorCount !== 'number' || options.colorCount < 2) {
    throw new Error('generatePaintByNumbers: options.colorCount must be >= 2');
  }
  if (typeof options.randomSeed !== 'number') {
    throw new Error('generatePaintByNumbers: options.randomSeed is required for deterministic output');
  }

  const settings = new Settings();
  settings.kMeansNrOfClusters = options.colorCount;
  // The engine treats seed === 0 as "use wall clock". Coerce to 1 so a caller
  // passing 0 still gets deterministic output instead of a silent surprise.
  settings.randomSeed = options.randomSeed === 0 ? 1 : options.randomSeed;

  const sizeMultiplier = options.sizeMultiplier ?? 3;
  const fontSize = options.fontSize ?? 12;
  const renderMode = options.renderMode ?? 'painting';

  const finalMinFacetSize = getMinFacetSizeForPiece(
    renderMode,
    fontSize,
    sizeMultiplier,
    options.minFacetSize,
  );
  settings.removeFacetsSmallerThanNrOfPoints = finalMinFacetSize;

  if (typeof options.maxFacets === 'number') {
    settings.maximumNumberOfFacets = options.maxFacets;
  }
  if (options.colorRestrictions) {
    settings.kMeansColorRestrictions = options.colorRestrictions;
  }

  if (renderMode === 'exact_source') {
    settings.narrowPixelStripCleanupRuns = 0;
  } else if (typeof options.narrowPixelStripCleanupRuns === 'number') {
    settings.narrowPixelStripCleanupRuns = options.narrowPixelStripCleanupRuns;
  }
  settings.kMeansClusteringColorSpace = COLOR_SPACE[options.clusteringColorSpace ?? 'rgb'];

  settings.resizeImageIfTooLarge = true;
  if (typeof options.resizeMaxWidth === 'number') settings.resizeImageWidth = options.resizeMaxWidth;
  if (typeof options.resizeMaxHeight === 'number') settings.resizeImageHeight = options.resizeMaxHeight;

  // ----- Load source bitmap onto a node-canvas surface -------
  const img = await nodeCanvas.loadImage(imageBuffer);
  let c: nodeCanvas.Canvas = nodeCanvas.createCanvas(img.width, img.height);
  let ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.drawImage(img as any, 0, 0, c.width, c.height);
  let imgData = ctx.getImageData(0, 0, c.width, c.height) as unknown as ImageData;

  // ----- Resize (mirrors src-cli/main.ts) --------------------
  if (
    settings.resizeImageIfTooLarge &&
    (c.width > settings.resizeImageWidth || c.height > settings.resizeImageHeight)
  ) {
    let width = c.width;
    let height = c.height;
    if (width > settings.resizeImageWidth) {
      const newWidth = settings.resizeImageWidth;
      const newHeight = Math.round((c.height / c.width) * settings.resizeImageWidth);
      width = newWidth;
      height = newHeight;
    }
    if (height > settings.resizeImageHeight) {
      const newHeight = settings.resizeImageHeight;
      const newWidth = Math.round((width / height) * newHeight);
      width = newWidth;
      height = newHeight;
    }
    const resized = nodeCanvas.createCanvas(width, height);
    const rctx = resized.getContext('2d') as unknown as CanvasRenderingContext2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rctx.drawImage(c as any, 0, 0, width, height);
    c = resized;
    ctx = rctx;
    imgData = ctx.getImageData(0, 0, width, height) as unknown as ImageData;
  }

  // ----- Pre-pass (portrait mode): sharpen + edge contours + tone ----
  if (renderMode !== 'exact_source') {
    const px = imgData.data as unknown as Uint8ClampedArray;
    const edge = options.edgeEmphasis ?? 0;
    if (edge > 0) {
      portraitLineArt(px, imgData.width, imgData.height, edge);
    }
    preprocessPixels(px, options.contrastBoost ?? 1, options.saturationBoost ?? 1);
  }

  // ----- k-means ---------------------------------------------
  const kCanvas = nodeCanvas.createCanvas(imgData.width, imgData.height);
  const kCtx = kCanvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  kCtx.fillStyle = 'white';
  kCtx.fillRect(0, 0, kCanvas.width, kCanvas.height);
  const kmeansImgData = kCtx.getImageData(
    0,
    0,
    kCanvas.width,
    kCanvas.height,
  ) as unknown as ImageData;
  await ColorReducer.applyKMeansClustering(imgData, kmeansImgData, ctx, settings);

  const colormapResult = ColorReducer.createColorMap(kmeansImgData);

  // ----- Facet pipeline (mirrors CLI control flow) -----------
  let facetResult = new FacetResult();
  if (!settings.narrowPixelStripCleanupRuns || settings.narrowPixelStripCleanupRuns === 0) {
    facetResult = await FacetCreator.getFacets(
      imgData.width,
      imgData.height,
      colormapResult.imgColorIndices,
      () => undefined,
    );
    await FacetReducer.reduceFacets(
      settings.removeFacetsSmallerThanNrOfPoints,
      settings.removeFacetsFromLargeToSmall,
      settings.maximumNumberOfFacets,
      colormapResult.colorsByIndex,
      facetResult,
      colormapResult.imgColorIndices,
      () => undefined,
    );
  } else {
    for (let run = 0; run < settings.narrowPixelStripCleanupRuns; run++) {
      await ColorReducer.processNarrowPixelStripCleanup(colormapResult);
      facetResult = await FacetCreator.getFacets(
        imgData.width,
        imgData.height,
        colormapResult.imgColorIndices,
        () => undefined,
      );
      await FacetReducer.reduceFacets(
        settings.removeFacetsSmallerThanNrOfPoints,
        settings.removeFacetsFromLargeToSmall,
        settings.maximumNumberOfFacets,
        colormapResult.colorsByIndex,
        facetResult,
        colormapResult.imgColorIndices,
        () => undefined,
      );
    }
  }

  await FacetBorderTracer.buildFacetBorderPaths(facetResult, () => undefined);
  await FacetBorderSegmenter.buildFacetBorderSegments(
    facetResult,
    settings.nrOfTimesToHalveBorderSegments,
    () => undefined,
  );
  await FacetLabelPlacer.buildFacetLabelBounds(facetResult, () => undefined);

  // ----- Render the two output profiles ---------------------
  const fontColor = options.fontColor ?? '#1A1A1A';
  const strokeWidth = options.strokeWidth ?? 1.0;
  const unifiedFontSize = options.unifiedFontSize ?? (renderMode !== 'exact_source');

  let base64Data: string | undefined;
  if (renderMode === 'exact_source') {
    base64Data = c.toBuffer('image/png').toString('base64');
  }

  // Profile 1: filled SVG (the finished-piece preview).
  const filledSvg = renderSvg(
    facetResult,
    colormapResult.colorsByIndex,
    sizeMultiplier,
    /* fill */ renderMode === 'exact_source' ? false : true,
    /* stroke */ renderMode === 'exact_source' ? true : false,
    /* labels */ renderMode === 'exact_source' ? true : false,
    fontSize,
    fontColor,
    strokeWidth,
    unifiedFontSize,
    base64Data,
  );
  // Profile 2: outline + numbers (the printable template).
  const outlineSvg = renderSvg(
    facetResult,
    colormapResult.colorsByIndex,
    sizeMultiplier,
    /* fill */ false,
    /* stroke */ true,
    /* labels */ true,
    fontSize,
    fontColor,
    strokeWidth,
    unifiedFontSize,
    undefined,
  );

  // ----- Palette JSON (one entry per color index) ------------
  const freq = colormapResult.colorsByIndex.map(() => 0);
  for (const facet of facetResult.facets) {
    if (facet !== null) freq[facet.color] += facet.pointCount;
  }
  const total = freq.reduce((a, b) => a + b, 0) || 1;
  const palette: PaletteEntry[] = colormapResult.colorsByIndex.map((rgb, idx) => ({
    index: idx,
    rgb: [rgb[0], rgb[1], rgb[2]] as [number, number, number],
    hex: rgbToHex(rgb),
    areaPercentage: freq[idx] / total,
    frequency: freq[idx],
  }));

  const serializedFacets = facetResult.facets
    .filter(f => f !== null)
    .map(f => {
      const path = f.getFullPathFromBorderSegments(false);
      if (
        path.length > 0 &&
        (path[0].x !== path[path.length - 1].x ||
         path[0].y !== path[path.length - 1].y)
      ) {
        path.push(path[0]);
      }
      return {
        id: f.id,
        color: f.color,
        path: path.map(p => ({ x: p.x, y: p.y })),
        labelBounds: {
          minX: f.labelBounds.minX,
          minY: f.labelBounds.minY,
          width: f.labelBounds.width,
          height: f.labelBounds.height,
        }
      };
    });

  const segmentationCache = {
    width: imgData.width,
    height: imgData.height,
    colorsByIndex: colormapResult.colorsByIndex,
    facets: serializedFacets
  };

  return {
    filledSvg,
    outlineSvg,
    palette,
    width: imgData.width,
    height: imgData.height,
    segmentationCache,
  };
}


// Direct port of src-cli/main.ts:createSVG. Two profiles share this; flags
// flip fills/strokes/labels.
function renderSvg(
  facetResult: FacetResult | { width: number; height: number; facets: unknown[] },
  colorsByIndex: RGB[],
  sizeMultiplier: number,
  fill: boolean,
  stroke: boolean,
  addLabels: boolean,
  fontSize: number,
  fontColor: string,
  strokeWidth: number = 1.0,
  unifiedFontSize: boolean = true,
  backgroundImageBase64?: string,
): string {
  const xmlns = 'http://www.w3.org/2000/svg';
  const svgWidth = sizeMultiplier * facetResult.width;
  const svgHeight = sizeMultiplier * facetResult.height;
  // viewBox is essential: without it the SVG won't scale to its display size
  // (CSS width/height just clips it), so consumers only see a corner of the
  // full-resolution drawing.
  let svg = `<?xml version="1.0" standalone="no"?>\n<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="${xmlns}">`;

  if (backgroundImageBase64) {
    svg += `\n<image href="data:image/png;base64,${backgroundImageBase64}" x="0" y="0" width="${svgWidth}" height="${svgHeight}" opacity="1.0" style="pointer-events: none;" />`;
  }

  for (const f of facetResult.facets) {
    if (f == null) continue;
    if (!('path' in f) && f.borderSegments.length === 0) continue;

    let path: Array<{ x: number; y: number }>;
    if ('path' in f) {
      path = f.path;
    } else {
      path = f.getFullPathFromBorderSegments(false);
      if (
        path[0].x !== path[path.length - 1].x ||
        path[0].y !== path[path.length - 1].y
      ) {
        path.push(path[0]);
      }
    }

    let d = `M ${path[0].x * sizeMultiplier} ${path[0].y * sizeMultiplier} `;
    for (let i = 1; i < path.length; i++) {
      const midX = (path[i].x + path[i - 1].x) / 2;
      const midY = (path[i].y + path[i - 1].y) / 2;
      d +=
        `Q ${midX * sizeMultiplier} ${midY * sizeMultiplier} ` +
        `${path[i].x * sizeMultiplier} ${path[i].y * sizeMultiplier} `;
    }

    const rgb = colorsByIndex[f.color];
    const rgbStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    const fillStr = fill ? rgbStr : 'none';
    // If we're filling but not stroking, paint the border with the fill color
    // to close the 1px gaps the curve approximation can leave between facets.
    const strokeStr = stroke ? '#000' : fill ? rgbStr : '';

    let style = `fill: ${fillStr};`;
    if (strokeStr) style += ` stroke: ${strokeStr}; stroke-width:${strokeWidth}px`;

    svg += `<path data-facetId="${f.id}" d="${d}" style="${style}"></path>`;

    if (addLabels) {
      const ox = f.labelBounds.minX * sizeMultiplier;
      const oy = f.labelBounds.minY * sizeMultiplier;
      const lw = f.labelBounds.width * sizeMultiplier;
      const lh = f.labelBounds.height * sizeMultiplier;
      const digits = String(f.color).length;
      
      let computedFontSize = fontSize;
      if (unifiedFontSize) {
        // Enforce padding constraint (5% margin from borders: text must fit in 90% of box size)
        const maxWidth = (lw * 0.9) / (digits * 0.6);
        const maxHeight = lh * 0.9;
        computedFontSize = Math.min(fontSize, maxWidth, maxHeight);
        computedFontSize = Math.max(1, computedFontSize);
      } else {
        computedFontSize = fontSize / digits;
      }

      // Center coords inside the bounds
      const cx = ox + lw / 2;
      const cy = oy + lh / 2;

      svg +=
        `<g class="label" data-facetId="${f.id}" data-color-index="${f.color}" transform="translate(${cx},${cy})">` +
        `<text x="0" y="0" font-family="Tahoma" font-size="${computedFontSize}" dominant-baseline="middle" text-anchor="middle" fill="${fontColor}">${f.color}</text>` +
        `</g>`;
    }
  }

  svg += `</svg>`;
  return svg;
}

function rgbToHex(rgb: number[]): string {
  return (
    '#' +
    rgb
      .slice(0, 3)
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
