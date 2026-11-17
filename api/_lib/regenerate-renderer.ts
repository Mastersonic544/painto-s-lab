import { relativeNumberSize, NUMBER_FONT } from '../../src/lib/numberSize';
export type RGB = [number, number, number];

export interface CachedFacet {
  id: number;
  color: number;
  path: Array<{ x: number; y: number }>;
  labelBounds: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
}

export interface CachedSegmentation {
  width: number;
  height: number;
  colorsByIndex: RGB[];
  facets: CachedFacet[];
}

/**
 * Rebuilds the SVGs from cached segmentation JSON.
 * Avoids any node-canvas dependency, making it safe for Vercel serverless functions.
 */
export function renderSvgCached(
  segmentation: CachedSegmentation,
  sizeMultiplier: number,
  fill: boolean,
  stroke: boolean,
  addLabels: boolean,
  fontSize: number,
  fontColor: string,
  strokeWidth: number = 1.0,
  _unifiedFontSize: boolean = true,
  backgroundImageBase64?: string,
): string {
  const xmlns = 'http://www.w3.org/2000/svg';
  const svgWidth = sizeMultiplier * segmentation.width;
  const svgHeight = sizeMultiplier * segmentation.height;
  let svg = `<?xml version="1.0" standalone="no"?>\n<svg width="${svgWidth}" height="${svgHeight}" data-number-size="${fontSize}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="${xmlns}">`;

  if (backgroundImageBase64) {
    svg += `\n<image href="data:image/png;base64,${backgroundImageBase64}" x="0" y="0" width="${svgWidth}" height="${svgHeight}" opacity="1.0" style="pointer-events: none;" />`;
  }

  let labels = '';
  for (const f of segmentation.facets) {
    if (f == null || !f.path || f.path.length === 0) continue;

    const path = f.path;
    let d = `M ${path[0].x * sizeMultiplier} ${path[0].y * sizeMultiplier} `;
    for (let i = 1; i < path.length; i++) {
      const midX = (path[i].x + path[i - 1].x) / 2;
      const midY = (path[i].y + path[i - 1].y) / 2;
      d +=
        `Q ${midX * sizeMultiplier} ${midY * sizeMultiplier} ` +
        `${path[i].x * sizeMultiplier} ${path[i].y * sizeMultiplier} `;
    }

    const rgb = segmentation.colorsByIndex[f.color];
    const rgbStr = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : 'rgb(0,0,0)';
    const fillStr = fill ? rgbStr : 'none';
    const strokeStr = stroke ? '#000' : fill ? rgbStr : '';

    let style = `fill: ${fillStr};`;
    if (strokeStr)
      style += ` stroke: ${strokeStr}; stroke-width:${stroke ? strokeWidth : 0.5}px; stroke-linejoin:round`;

    svg += `<path data-facetId="${f.id}" d="${d} Z" style="${style}"></path>`;

    if (addLabels) {
      const ox = f.labelBounds.minX * sizeMultiplier;
      const oy = f.labelBounds.minY * sizeMultiplier;
      const lw = f.labelBounds.width * sizeMultiplier;
      const lh = f.labelBounds.height * sizeMultiplier;
      const computedFontSize = relativeNumberSize(fontSize, lw, lh, String(f.color).length);

      // Center coords inside the bounds
      const cx = ox + lw / 2;
      const cy = oy + lh / 2;

      labels +=
        `<g class="label" data-facetId="${f.id}" data-color-index="${f.color}" transform="translate(${cx},${cy})">` +
        `<text x="0" y="0" font-family="${NUMBER_FONT}" font-weight="300" stroke="none" data-label-width="${lw}" data-label-height="${lh}" font-size="${computedFontSize}" dominant-baseline="middle" text-anchor="middle" fill="${fontColor}">${f.color}</text>` +
        `</g>`;
    }
  }

  svg += labels + `</svg>`;
  return svg;
}
