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
import { Settings } from './src/settings';
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

  if (typeof options.minFacetSize === 'number') {
    settings.removeFacetsSmallerThanNrOfPoints = options.minFacetSize;
  }
  if (typeof options.maxFacets === 'number') {
    settings.maximumNumberOfFacets = options.maxFacets;
  }
  if (options.colorRestrictions) {
    settings.kMeansColorRestrictions = options.colorRestrictions;
  }
  if (typeof options.narrowPixelStripCleanupRuns === 'number') {
    settings.narrowPixelStripCleanupRuns = options.narrowPixelStripCleanupRuns;
  }

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
  const sizeMultiplier = options.sizeMultiplier ?? 3;
  const fontSize = options.fontSize ?? 50;
  const fontColor = options.fontColor ?? '#1A1A1A';

  // Profile 1: filled SVG (the finished-piece preview).
  const filledSvg = renderSvg(
    facetResult,
    colormapResult.colorsByIndex,
    sizeMultiplier,
    /* fill */ true,
    /* stroke */ false,
    /* labels */ false,
    fontSize,
    fontColor,
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

  return {
    filledSvg,
    outlineSvg,
    palette,
    width: imgData.width,
    height: imgData.height,
  };
}

// Direct port of src-cli/main.ts:createSVG. Two profiles share this; flags
// flip fills/strokes/labels.
function renderSvg(
  facetResult: FacetResult,
  colorsByIndex: RGB[],
  sizeMultiplier: number,
  fill: boolean,
  stroke: boolean,
  addLabels: boolean,
  fontSize: number,
  fontColor: string,
): string {
  const xmlns = 'http://www.w3.org/2000/svg';
  const svgWidth = sizeMultiplier * facetResult.width;
  const svgHeight = sizeMultiplier * facetResult.height;
  let svg = `<?xml version="1.0" standalone="no"?>\n<svg width="${svgWidth}" height="${svgHeight}" xmlns="${xmlns}">`;

  for (const f of facetResult.facets) {
    if (f == null || f.borderSegments.length === 0) continue;

    const path = f.getFullPathFromBorderSegments(false);
    if (
      path[0].x !== path[path.length - 1].x ||
      path[0].y !== path[path.length - 1].y
    ) {
      path.push(path[0]);
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
    if (strokeStr) style += ` stroke: ${strokeStr}; stroke-width:1px`;

    svg += `<path data-facetId="${f.id}" d="${d}" style="${style}"></path>`;

    if (addLabels) {
      const ox = f.labelBounds.minX * sizeMultiplier;
      const oy = f.labelBounds.minY * sizeMultiplier;
      const lw = f.labelBounds.width * sizeMultiplier;
      const lh = f.labelBounds.height * sizeMultiplier;
      const digits = String(f.color).length;
      svg +=
        `<g class="label" transform="translate(${ox},${oy})">` +
        `<svg width="${lw}" height="${lh}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">` +
        `<text font-family="Tahoma" font-size="${fontSize / digits}" dominant-baseline="middle" text-anchor="middle" fill="${fontColor}">${f.color}</text>` +
        `</svg></g>`;
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
