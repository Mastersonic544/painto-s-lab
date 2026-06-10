import { supabase } from './supabase';
import type { ModelDecision, Tier } from './complexity';

export interface UploadedSource {
  sourceImageId: string;
  storagePath: string;
  uploaderId: string;
}

/** Phase 1 of intake: get the bitmap into source-images. Cheap, fast. */
export async function uploadSourceImage(file: File): Promise<UploadedSource> {
  const { data: who, error: whoErr } = await supabase.auth.getUser();
  if (whoErr) throw whoErr;
  const user = who?.user;
  if (!user) throw new Error('Not signed in.');

  const safeName = file.name.replace(/[^\w.\- ]/g, '_');
  const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const upload = await supabase.storage
    .from('source-images')
    .upload(storagePath, file, {
      contentType: file.type || 'image/png',
      upsert: false,
    });
  if (upload.error) throw upload.error;

  const { data: source, error: srcErr } = await supabase
    .from('source_images')
    .insert({
      storage_path: storagePath,
      original_filename: file.name,
      uploaded_by: user.id,
    })
    .select('id')
    .single();
  if (srcErr) throw srcErr;

  return { sourceImageId: source.id, storagePath, uploaderId: user.id };
}

export interface CreatePieceArgs {
  sourceImageId: string;
  title: string;
  colorCount: number;
  canvasWidthCm: number;
  canvasHeightCm: number;
  coats: number;
  /** PRD §4: mode the operator chose, captured for audit. */
  mode: 'auto' | 'manual';
  /** Tier label even when the operator overrode the count. */
  complexity: Tier;
  /** Conversion algorithm: 'painting' (default) or 'portrait'. */
  renderMode: 'painting' | 'portrait';
}

/** Phase 2: insert pieces row with the chosen settings and fire /api/generate. */
export async function createPieceAndQueue(args: CreatePieceArgs): Promise<{ pieceId: string }> {
  const baseRow = {
    source_image_id: args.sourceImageId,
    title: args.title,
    status: 'queued' as const,
    mode: args.mode,
    complexity: args.complexity,
    color_count: args.colorCount,
    canvas_width_cm: args.canvasWidthCm,
    canvas_height_cm: args.canvasHeightCm,
    coats: args.coats,
  };
  let res = await supabase
    .from('pieces')
    .insert({ ...baseRow, render_mode: args.renderMode })
    .select('id')
    .single();
  // Gracefully degrade if the render_mode migration hasn't been applied yet.
  if (res.error && /render_mode/i.test(res.error.message)) {
    res = await supabase.from('pieces').insert(baseRow).select('id').single();
  }
  if (res.error) throw res.error;
  const piece = res.data;

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('No access token to invoke /api/generate.');

  // Fire-and-forget; the UI subscribes via Realtime.
  void fetch('/api/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ pieceId: piece.id }),
  }).catch((err) => {
    console.warn('[createPieceAndQueue] /api/generate fetch failed:', err);
  });

  return { pieceId: piece.id };
}

/**
 * Ask the OpenRouter vision model for a complexity rating. Returns null
 * cleanly when the model is unavailable so the caller can fall back to the
 * pure-algorithmic decision without surfacing an error to the operator.
 */
export async function fetchModelDecision(
  sourceImageId: string,
): Promise<{ model: ModelDecision | null; error: string | null }> {
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) return { model: null, error: 'Not signed in.' };

  try {
    const resp = await fetch('/api/decide-complexity', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ sourceImageId }),
    });
    const json = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      tier?: 'simple' | 'normal' | 'complex';
      suggestedCount?: number;
      reason?: string;
      error?: string;
    };
    if (!resp.ok || json.ok === false || !json.tier) {
      return { model: null, error: json.error ?? `HTTP ${resp.status}` };
    }
    return {
      model: {
        tier: json.tier,
        suggestedCount: json.suggestedCount ?? 16,
        reason: json.reason,
      },
      error: null,
    };
  } catch (err) {
    return { model: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function signedUrl(bucket: string, path: string, expiresSec = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresSec);
  if (error) throw error;
  return data.signedUrl;
}
