// =============================================================
// Painto's Lab — complexity scoring (PRD §4)
// Runs entirely in the browser on a thumbnail so the operator
// sees the algorithmic fallback instantly, with no upload round
// trip. Same signal the OpenRouter vision model is asked for,
// so the two can be cross-checked.
// =============================================================

export type Tier = 'simple' | 'normal' | 'complex';

export const TIER_TO_COLOR_COUNT: Record<Tier, number> = {
  simple: 8,
  normal: 16,
  complex: 32,
};

const TIER_RANK: Record<Tier, number> = { simple: 0, normal: 1, complex: 2 };
const RANK_TO_TIER: Tier[] = ['simple', 'normal', 'complex'];

/** Round-up rule (PRD §4): if any signal lands between two tiers, pick the higher one. */
export function maxTier(a: Tier, b: Tier): Tier {
  return RANK_TO_TIER[Math.max(TIER_RANK[a], TIER_RANK[b])];
}

export interface AlgorithmicScore {
  /** Distinct 5-bit-per-channel buckets in the thumbnail. */
  distinctColors: number;
  /** 0..1, fraction of thumbnail pixels classified as edges by Sobel. */
  edgeDensity: number;
  /** Connected-component count after quantization. */
  regionCount: number;
  /** 0..1, normalized RGB stddev across the thumbnail. */
  colorVariance: number;
  /** 0..1 weighted sum. */
  score: number;
  tier: Tier;
}

export interface ModelDecision {
  tier: Tier;
  suggestedCount: number;
  reason?: string;
}

export interface ComplexityDecision {
  algorithmic: AlgorithmicScore;
  model: ModelDecision | null;
  modelError: string | null;
  /** Tier after combining model + algorithmic with the round-up rule. */
  finalTier: Tier;
  /** Final integer color count fed to the engine. */
  finalCount: number;
  /** Which signals fed the final decision. */
  source: 'model+algorithmic' | 'algorithmic-fallback';
}

/**
 * Run all four metrics on a downsampled copy of the input image.
 *
 * Thumbnail size matters: too small loses regions, too large slows the page.
 * 200×200 ≈ 40k pixels — flood-fill finishes in well under 100ms.
 */
export async function computeAlgorithmicScore(file: File): Promise<AlgorithmicScore> {
  const img = await fileToImage(file);
  const { canvas, ctx } = drawThumbnail(img, 200);
  const w = canvas.width;
  const h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);
  const n = w * h;

  // --- 1. Quantize to 5 bits per channel -------------------
  // Cheap proxy for what k-means would land on. Same signal the
  // engine itself uses for its first pass.
  const quantized = new Uint32Array(n);
  const distinctSet = new Set<number>();
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] >> 3;
    const g = data[i * 4 + 1] >> 3;
    const b = data[i * 4 + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    quantized[i] = key;
    distinctSet.add(key);
  }
  const distinctColors = distinctSet.size;

  // --- 2. Sobel edge density --------------------------------
  // Full Canny is overkill for a tier-level signal; Sobel magnitude
  // over a luma channel and a fixed threshold lands in the same place.
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = Math.round(
      data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114,
    );
  }
  let edgePixels = 0;
  const edgeThreshold = 80;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = gray[(y - 1) * w + (x - 1)];
      const tc = gray[(y - 1) * w + x];
      const tr = gray[(y - 1) * w + (x + 1)];
      const ml = gray[y * w + (x - 1)];
      const mr = gray[y * w + (x + 1)];
      const bl = gray[(y + 1) * w + (x - 1)];
      const bc = gray[(y + 1) * w + x];
      const br = gray[(y + 1) * w + (x + 1)];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      if (Math.abs(gx) + Math.abs(gy) > edgeThreshold) edgePixels++;
    }
  }
  const edgeDensity = edgePixels / n;

  // --- 3. Region count via flood fill -----------------------
  // 4-connected components on the quantized buffer. Stack-based to
  // avoid recursion blow-ups on photographic inputs.
  const visited = new Uint8Array(n);
  let regionCount = 0;
  const stack: number[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (visited[seed]) continue;
    regionCount++;
    const color = quantized[seed];
    stack.push(seed);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited[cur]) continue;
      if (quantized[cur] !== color) continue;
      visited[cur] = 1;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      if (cx > 0) stack.push(cur - 1);
      if (cx < w - 1) stack.push(cur + 1);
      if (cy > 0) stack.push(cur - w);
      if (cy < h - 1) stack.push(cur + w);
    }
  }

  // --- 4. Color variance ------------------------------------
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let i = 0; i < n; i++) {
    rSum += data[i * 4];
    gSum += data[i * 4 + 1];
    bSum += data[i * 4 + 2];
  }
  const rM = rSum / n;
  const gM = gSum / n;
  const bM = bSum / n;
  let varAccum = 0;
  for (let i = 0; i < n; i++) {
    const dr = data[i * 4] - rM;
    const dg = data[i * 4 + 1] - gM;
    const db = data[i * 4 + 2] - bM;
    varAccum += dr * dr + dg * dg + db * db;
  }
  // Variance ranges roughly 0..16k for real photos; normalize by an
  // empirical ceiling. A flat field is near 0, a busy photo > 1.
  const colorVariance = Math.min(1, varAccum / n / 8000);

  // --- Combine into 0..1 score ------------------------------
  // Weights tilt toward edges + regions since those are the strongest
  // proxies for "the engine will produce a lot of facets".
  const distinctNorm = Math.min(1, distinctColors / 4000);
  const regionNorm = Math.min(1, regionCount / 800);
  const score =
    distinctNorm * 0.2 + edgeDensity * 0.3 + regionNorm * 0.35 + colorVariance * 0.15;

  const tier: Tier = score < 0.33 ? 'simple' : score < 0.66 ? 'normal' : 'complex';
  return { distinctColors, edgeDensity, regionCount, colorVariance, score, tier };
}

/** Apply the round-up rule from PRD §4 to a model + algorithmic pair. */
export function combineDecision(
  algorithmic: AlgorithmicScore,
  model: ModelDecision | null,
  modelError: string | null,
): ComplexityDecision {
  const finalTier = model ? maxTier(model.tier, algorithmic.tier) : algorithmic.tier;
  const finalCount = TIER_TO_COLOR_COUNT[finalTier];
  return {
    algorithmic,
    model,
    modelError,
    finalTier,
    finalCount,
    source: model ? 'model+algorithmic' : 'algorithmic-fallback',
  };
}

/** Manual custom count override: pass through verbatim, clamped to a sane range. */
export function clampCustomCount(n: number): number {
  if (!Number.isFinite(n)) return 16;
  return Math.max(2, Math.min(64, Math.round(n)));
}

// The intake color slider runs 4..32 — 3 fixed tiers were too coarse.
export const MIN_COLORS = 4;
export const MAX_COLORS = 32;

export function clampColorCount(n: number): number {
  if (!Number.isFinite(n)) return 16;
  return Math.max(MIN_COLORS, Math.min(MAX_COLORS, Math.round(n)));
}

/** Map a chosen color count back to a tier label for the DB `complexity` field. */
export function tierFromCount(n: number): Tier {
  if (n <= 10) return 'simple';
  if (n <= 20) return 'normal';
  return 'complex';
}

// ----- helpers -----------------------------------------------

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function drawThumbnail(
  img: HTMLImageElement,
  maxEdge: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser refused a 2D canvas context');
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx };
}
