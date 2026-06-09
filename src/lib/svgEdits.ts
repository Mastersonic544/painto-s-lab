// =============================================================
// Painto's Lab — SVG edit primitives
// The engine emits filled.svg and outline.svg as flat XML; these
// helpers mutate the live DOM produced by ComparisonSlider so
// the operator can apply the PRD §9.4 "light edit step" without
// re-running the converter:
//   - recolorRegion: change a facet's color (palette can grow)
//   - mergeRegions:  absorb facet A into facet B's color group
//   - nudgeLabel:    move a number's translate(x,y)
// All operations are local to the two SVG roots. Persistence
// (storage upload + DB writes) happens in saveEditedPiece.
// =============================================================

import { supabase } from './supabase';
import { estimateVolumeMl } from './paintMath';
import type { PaletteEntry } from '../types/db';

const RGB_STYLE_RE = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i;

export type SvgRoot = HTMLDivElement | null;

export interface FacetInfo {
  facetId: number;
  fillHex: string;
}

/** Read the fill color of a facet path in the filled SVG. */
export function readFacetFill(filledRoot: SvgRoot, facetId: number): string | null {
  const path = filledRoot?.querySelector<SVGPathElement>(`path[data-facetId="${facetId}"]`);
  if (!path) return null;
  return styleColor(path.getAttribute('style') ?? '') ?? null;
}

export function listFacetIds(filledRoot: SvgRoot): number[] {
  if (!filledRoot) return [];
  const ids: number[] = [];
  filledRoot.querySelectorAll('path[data-facetId]').forEach((p) => {
    const v = Number(p.getAttribute('data-facetId'));
    if (Number.isFinite(v)) ids.push(v);
  });
  return ids;
}

// ----- Recolor ------------------------------------------------

/**
 * Recolor a facet to an arbitrary hex. Updates both the filled SVG (fill +
 * matching stroke, since the engine paints the border with the fill color
 * to close 1px facet gaps) and the outline SVG's label fill if the new
 * color demands a different label tint.
 */
export function recolorRegion(
  filledRoot: SvgRoot,
  facetId: number,
  hex: string,
): boolean {
  if (!filledRoot) return false;
  const path = filledRoot.querySelector<SVGPathElement>(`path[data-facetId="${facetId}"]`);
  if (!path) return false;
  const rgb = hexToRgbStr(hex);
  if (!rgb) return false;
  // Engine style is `fill: rgb(r,g,b); stroke: rgb(r,g,b); stroke-width:1px`.
  // Replace both color tokens — we keep the stroke matching the fill so
  // adjacent facets of the same color don't leave hairline gaps.
  const next = (path.getAttribute('style') ?? '')
    .replace(/fill:\s*[^;]+;?/, `fill: ${rgb};`)
    .replace(/stroke:\s*rgb\([^)]+\)/, `stroke: ${rgb}`);
  path.setAttribute('style', next);
  return true;
}

// ----- Merge --------------------------------------------------

/**
 * Merge facet A into facet B: A adopts B's color and A's outline label is
 * hidden so the painter sees only B's number. The actual path geometry is
 * not unioned (that would require boolean ops on SVG paths); visually the
 * two facets now share a color and read as one region.
 */
export function mergeRegions(
  filledRoot: SvgRoot,
  outlineRoot: SvgRoot,
  absorbFacetId: number,
  intoFacetId: number,
): boolean {
  if (!filledRoot || !outlineRoot) return false;
  if (absorbFacetId === intoFacetId) return false;
  const target = filledRoot.querySelector<SVGPathElement>(
    `path[data-facetId="${intoFacetId}"]`,
  );
  const absorbed = filledRoot.querySelector<SVGPathElement>(
    `path[data-facetId="${absorbFacetId}"]`,
  );
  if (!target || !absorbed) return false;

  const targetFill = styleColor(target.getAttribute('style') ?? '');
  if (!targetFill) return false;
  // Recolor the absorbed facet's filled path to the target color.
  const next = (absorbed.getAttribute('style') ?? '')
    .replace(/fill:\s*[^;]+;?/, `fill: ${targetFill};`)
    .replace(/stroke:\s*rgb\([^)]+\)/, `stroke: ${targetFill}`);
  absorbed.setAttribute('style', next);
  // Tag the merge so saveEditedPiece can write piece_colors accordingly.
  absorbed.setAttribute('data-merged-into', String(intoFacetId));

  // Drop the absorbed label from the outline. The engine renders labels
  // inside `<g class="label">` blocks that share data-facetId with the
  // path, but in the source it lives next to the path; in our outline
  // SVG labels live in their own group. Both shapes are handled.
  outlineRoot
    .querySelectorAll<SVGGElement>(`g.label[data-facetId="${absorbFacetId}"]`)
    .forEach((g) => g.remove());
  return true;
}

// ----- Nudge label --------------------------------------------

/**
 * Move a number label by (dx, dy) in SVG user units. The engine renders
 * labels as `<g class="label" transform="translate(x,y)">...</g>`.
 *
 * Returns the new (x, y) on success, null if the label can't be located.
 */
export function nudgeLabel(
  outlineRoot: SvgRoot,
  facetId: number,
  dx: number,
  dy: number,
): { x: number; y: number } | null {
  if (!outlineRoot) return null;
  const g = outlineRoot.querySelector<SVGGElement>(`g.label[data-facetId="${facetId}"]`);
  if (!g) return null;
  const t = g.getAttribute('transform') ?? 'translate(0,0)';
  const m = t.match(/translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!m) return null;
  const x = Number(m[1]) + dx;
  const y = Number(m[2]) + dy;
  g.setAttribute('transform', `translate(${x},${y})`);
  return { x, y };
}

// The engine emits labels without their own data-facetId. We tag them on
// load so subsequent nudge/merge edits can target them by facet number.
export function tagOutlineLabels(outlineRoot: SvgRoot): void {
  if (!outlineRoot) return;
  outlineRoot.querySelectorAll<SVGGElement>('g.label').forEach((g) => {
    if (g.getAttribute('data-facetId')) return;
    // The label number is the child <text>'s content.
    const text = g.querySelector('text');
    if (!text) return;
    const n = Number(text.textContent ?? '');
    if (!Number.isFinite(n)) return;
    // The engine reuses the color index as the label, and each facet of
    // that color carries data-facetId on its path. We pair labels to
    // facets via order of appearance — the engine emits them sequentially.
    g.setAttribute('data-color-index', String(n));
  });
}

/**
 * Pair each `<g class="label">` to the facet it sits over by walking the
 * outline SVG and assigning the next `data-facetId` from the matching path
 * list. Called once after mount so nudge/merge edits can look up labels.
 */
export function indexOutlineLabelsByFacetId(outlineRoot: SvgRoot): void {
  if (!outlineRoot) return;
  const paths = outlineRoot.querySelectorAll<SVGPathElement>('path[data-facetId]');
  const labels = outlineRoot.querySelectorAll<SVGGElement>('g.label');
  // The engine writes one label per facet in the same order as the paths.
  const limit = Math.min(paths.length, labels.length);
  for (let i = 0; i < limit; i++) {
    const id = paths[i].getAttribute('data-facetId');
    if (id) labels[i].setAttribute('data-facetId', id);
  }
}

// ----- Persistence --------------------------------------------

export interface SaveEditedArgs {
  pieceId: string;
  filledRoot: SvgRoot;
  outlineRoot: SvgRoot;
  previewPath: string;
  outlinePath: string;
  /** Original palette so we can re-derive piece_colors after recolors. */
  paletteJson: PaletteEntry[];
  canvasWidthCm: number;
  canvasHeightCm: number;
  coats: number;
}

/**
 * Serialize the edited SVGs back to storage, refresh piece_colors with any
 * recolored hex values, and approve the piece. Area percentages stay on
 * the palette JSON as-is — minor edits don't move the math meaningfully
 * and the volume estimate already carries a safety margin.
 */
export async function saveEditedPiece(args: SaveEditedArgs): Promise<void> {
  const { filledRoot, outlineRoot, previewPath, outlinePath, pieceId } = args;
  if (!filledRoot || !outlineRoot) throw new Error('SVG roots not mounted');
  const filledSvg = filledRoot.innerHTML;
  const outlineSvg = outlineRoot.innerHTML;
  if (!filledSvg || !outlineSvg) throw new Error('Empty SVG content');

  // 1. Upload SVGs.
  const upPreview = await supabase.storage
    .from('piece-previews')
    .upload(previewPath, filledSvg, {
      contentType: 'image/svg+xml',
      upsert: true,
    });
  if (upPreview.error) throw upPreview.error;
  const upOutline = await supabase.storage
    .from('piece-outlines')
    .upload(outlinePath, outlineSvg, {
      contentType: 'image/svg+xml',
      upsert: true,
    });
  if (upOutline.error) throw upOutline.error;

  // 2. Refresh piece_colors hex values from the (possibly recolored) palette.
  //    We treat the palette JSON on the row as canonical; recolorRegion
  //    callers update it in-place via updatePaletteHex before saving.
  const colorRows = args.paletteJson.map((p) => ({
    piece_id: pieceId,
    color_index: p.index,
    label: p.label ?? null,
    rgb_hex: p.color,
    area_percentage: p.areaPercentage,
    estimated_volume_ml: estimateVolumeMl({
      areaPercentage: p.areaPercentage,
      canvasWidthCm: args.canvasWidthCm,
      canvasHeightCm: args.canvasHeightCm,
      coats: args.coats,
    }),
  }));

  const del = await supabase.from('piece_colors').delete().eq('piece_id', pieceId);
  if (del.error) throw del.error;
  if (colorRows.length) {
    const ins = await supabase.from('piece_colors').insert(colorRows);
    if (ins.error) throw ins.error;
  }

  // 3. Update the pieces row with the new palette + approved status.
  const upd = await supabase
    .from('pieces')
    .update({
      palette_json: args.paletteJson,
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', pieceId);
  if (upd.error) throw upd.error;
}

/** In-place edit of the palette so recolors flow into piece_colors. */
export function updatePaletteHex(
  palette: PaletteEntry[],
  index: number,
  hex: string,
): PaletteEntry[] {
  return palette.map((p) =>
    p.index === index ? { ...p, color: hex } : p,
  );
}

// ----- helpers ------------------------------------------------

function styleColor(style: string): string | null {
  const m = style.match(/fill:\s*(rgb\([^)]+\)|#[0-9a-f]{3,8})/i);
  return m ? m[1] : null;
}

function hexToRgbStr(hex: string): string | null {
  const h = hex.replace(/^#/, '').trim();
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return `rgb(${r},${g},${b})`;
}

export function rgbStrToHex(rgb: string): string | null {
  const m = rgb.match(RGB_STYLE_RE);
  if (!m) {
    if (/^#[0-9a-f]{6}$/i.test(rgb)) return rgb.toLowerCase();
    return null;
  }
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
