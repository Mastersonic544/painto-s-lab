// =============================================================
// Painto's Lab — generation job runner
// Pure function: given a pieceId, run the conversion pipeline,
// upload the SVGs, fan out piece_colors, flip status to 'ready'.
// Shared by:
//   - api/generate.ts        (Vercel serverless trigger)
//   - engine/run-job.ts      (CLI / dedicated worker fallback)
//
// PRD §5 calls out that k-means on a full image is CPU-heavy and
// can exceed serverless time limits. We cap the engine's resize
// aggressively for the serverless path. If/when uploads regularly
// stretch past the function timeout (60s on Pro, 10s on Hobby),
// switch the trigger to enqueue work for a dedicated long-running
// worker — engine/run-job.ts is wired to be that worker as-is.
// =============================================================

import { SupabaseClient } from '@supabase/supabase-js';
import { generatePaintByNumbers } from '../../engine/generate';
import { estimateVolumeMl } from '../../src/lib/paintMath';
import type { Database, PaletteJson } from '../../src/types/db';

const SOURCE_BUCKET = 'source-images';
const PREVIEW_BUCKET = 'piece-previews';
const OUTLINE_BUCKET = 'piece-outlines';

export interface RunJobOptions {
  /** Cap on the long edge of the bitmap before k-means runs. */
  resizeMaxEdge?: number;
  /** Engine "remove facets smaller than N points" threshold. */
  minFacetSize?: number;
  /** Hard cap on the number of regions (facets). */
  maxFacets?: number;
}

export interface RunJobResult {
  pieceId: string;
  previewPath: string;
  outlinePath: string;
  paletteSize: number;
  durationMs: number;
}

/**
 * Run the engine for one queued piece end-to-end.
 *
 * Throws on any unrecoverable error; the caller is expected to
 * translate that into a piece row update with status='error'.
 */
export async function runGenerationJob(
  admin: SupabaseClient<Database>,
  pieceId: string,
  opts: RunJobOptions = {},
): Promise<RunJobResult> {
  const startedAt = Date.now();

  // 1. Load the piece and its source image record.
  const { data: piece, error: pieceErr } = await admin
    .from('pieces')
    .select('*')
    .eq('id', pieceId)
    .maybeSingle();
  if (pieceErr) throw new Error(`Load piece: ${pieceErr.message}`);
  if (!piece) throw new Error(`Piece ${pieceId} not found`);

  if (piece.status !== 'queued') {
    // Idempotency: refuse to re-process unless explicitly re-queued.
    throw new Error(`Piece ${pieceId} status is '${piece.status}', not 'queued'`);
  }

  const { data: source, error: srcErr } = await admin
    .from('source_images')
    .select('*')
    .eq('id', piece.source_image_id)
    .maybeSingle();
  if (srcErr) throw new Error(`Load source image: ${srcErr.message}`);
  if (!source) throw new Error(`Source image ${piece.source_image_id} not found`);

  // 2. Download the source bitmap from storage.
  const dl = await admin.storage.from(SOURCE_BUCKET).download(source.storage_path);
  if (dl.error || !dl.data) {
    throw new Error(`Download source: ${dl.error?.message ?? 'no data'}`);
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());

  // 3. Run the engine. The resize cap below is the main lever for
  // keeping us inside the function timeout — larger images quickly
  // run past 60s. Larger inputs belong on the dedicated worker.
  const seed = derivePieceSeed(piece.id);
  // render_mode may be undefined until the migration is applied → painting.
  const portrait = (piece as { render_mode?: string }).render_mode === 'portrait';

  // Tuned so the job finishes within a modest backend's CPU/RAM. Without a
  // facet cap the engine produced 30k+ regions (unpaintable, and it pegged the
  // CPU / exhausted memory for 10+ minutes — Render then killed it mid-job).
  // Portrait mode keeps small high-contrast features (eyes) alive: perceptual
  // LAB clustering, a contrast/saturation pre-pass, smaller facets, higher cap.
  // Working resolution is THE speed/memory lever (not the canvas DPI). Lower
  // it aggressively so jobs finish on a modest box. Portrait gets the quality
  // boost from LAB clustering + a contrast pre-pass rather than from tiny
  // facets, so it can run at a similar cost to painting.
  // Env override for quick tuning without a redeploy: CONVERTER_MAX_EDGE.
  const envEdge = Number(process.env.CONVERTER_MAX_EDGE);
  const resizeMaxEdge =
    opts.resizeMaxEdge ?? (Number.isFinite(envEdge) && envEdge > 0 ? envEdge : portrait ? 512 : 512);
  const genOptions = {
    colorCount: piece.color_count,
    randomSeed: seed,
    // Portrait: bigger min facet drops texture noise (keeps only the major
    // contours) and keeps the job fast on a modest box.
    minFacetSize: opts.minFacetSize ?? (portrait ? 24 : 40),
    maxFacets: opts.maxFacets ?? (portrait ? 3500 : 3000),
    // Portrait keeps the thin contour lines: 0 = skip narrow-strip cleanup,
    // which would otherwise erase them into dashes.
    narrowPixelStripCleanupRuns: portrait ? 0 : 1,
    resizeMaxWidth: resizeMaxEdge,
    resizeMaxHeight: resizeMaxEdge,
    clusteringColorSpace: (portrait ? 'lab' : 'rgb') as 'lab' | 'rgb',
    contrastBoost: portrait ? 1.1 : 1,
    saturationBoost: portrait ? 1.1 : 1,
    // Portrait line-art: Canny contours burned black + flattened fills. Tune
    // line density live with CONVERTER_EDGE (0..1, higher = more lines).
    edgeEmphasis: portrait ? portraitEdgeStrength() : 0,
  };

  // The engine logs verbosely (per reallocated point, per border step). With
  // stdout piped (e.g. Render) those synchronous writes dominate runtime, so
  // silence non-error logs for the duration of the job.
  const origLog = console.log;
  const origWarn = console.warn;
  const origInfo = console.info;
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  let result;
  try {
    result = await generatePaintByNumbers(buf, genOptions);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.info = origInfo;
  }

  // 4. Upload SVGs. Storage paths shadow the piece id so they're
  // easy to clean up if the piece is deleted later.
  const previewPath = `${piece.id}/filled.svg`;
  const outlinePath = `${piece.id}/outline.svg`;
  const upPreview = await admin.storage
    .from(PREVIEW_BUCKET)
    .upload(previewPath, result.filledSvg, {
      contentType: 'image/svg+xml',
      upsert: true,
    });
  if (upPreview.error) throw new Error(`Upload preview: ${upPreview.error.message}`);

  const upOutline = await admin.storage
    .from(OUTLINE_BUCKET)
    .upload(outlinePath, result.outlineSvg, {
      contentType: 'image/svg+xml',
      upsert: true,
    });
  if (upOutline.error) throw new Error(`Upload outline: ${upOutline.error.message}`);

  // 5. Write the palette JSON and fan out piece_colors. Paint math
  // (PRD §7) reads area_percentage × canvas area × coats × coverage,
  // so estimate volumes now while we have the canvas dims handy.
  const paletteJson: PaletteJson = result.palette.map((p) => ({
    index: p.index,
    color: p.hex,
    areaPercentage: p.areaPercentage,
    frequency: p.frequency,
  }));

  // PRD §7: area_cm2 * coats * coverage_factor * safety_margin, rounded
  // up. The constants live in src/lib/paintMath.ts so server and client
  // can never drift.
  const colorRows = result.palette.map((p) => ({
    piece_id: piece.id,
    color_index: p.index,
    label: null as string | null,
    rgb_hex: p.hex,
    area_percentage: p.areaPercentage,
    estimated_volume_ml: estimateVolumeMl({
      areaPercentage: p.areaPercentage,
      canvasWidthCm: piece.canvas_width_cm,
      canvasHeightCm: piece.canvas_height_cm,
      coats: piece.coats,
    }),
  }));

  // Replace any stragglers from a previous run, then insert fresh.
  const delCols = await admin.from('piece_colors').delete().eq('piece_id', piece.id);
  if (delCols.error) throw new Error(`Clear piece_colors: ${delCols.error.message}`);

  if (colorRows.length > 0) {
    const insCols = await admin.from('piece_colors').insert(colorRows);
    if (insCols.error) throw new Error(`Insert piece_colors: ${insCols.error.message}`);
  }

  // 6. Flip status to 'ready'. Anything beyond this point shouldn't
  // mark the piece as failed — the artifacts are committed.
  const upd = await admin
    .from('pieces')
    .update({
      status: 'ready',
      preview_svg_path: previewPath,
      outline_svg_path: outlinePath,
      palette_json: paletteJson,
      error_message: null,
    })
    .eq('id', piece.id);
  if (upd.error) throw new Error(`Mark ready: ${upd.error.message}`);

  return {
    pieceId: piece.id,
    previewPath,
    outlinePath,
    paletteSize: result.palette.length,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Mark a piece as failed. Best-effort: callers shouldn't re-throw
 * from inside the failure path.
 */
export async function markPieceError(
  admin: SupabaseClient<Database>,
  pieceId: string,
  message: string,
): Promise<void> {
  try {
    await admin
      .from('pieces')
      .update({ status: 'error', error_message: message.slice(0, 1000) })
      .eq('id', pieceId);
  } catch {
    // Swallow — there's nothing useful to do if even the error
    // write fails. The original failure has already been logged.
  }
}

/** Portrait line density, tunable live via CONVERTER_EDGE (0..1). */
function portraitEdgeStrength(): number {
  const v = Number(process.env.CONVERTER_EDGE);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8;
}

/** Stable per-piece seed so re-runs are byte-identical. */
function derivePieceSeed(pieceId: string): number {
  let h = 2166136261;
  for (let i = 0; i < pieceId.length; i++) {
    h ^= pieceId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // The engine treats 0 as "use wall clock"; force >= 1.
  return (h >>> 0) || 1;
}
