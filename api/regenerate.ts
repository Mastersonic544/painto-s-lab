import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdmin } from './_lib/admin';
import { renderSvgCached } from './_lib/regenerate-renderer';

export const config = {
  maxDuration: 60,
};

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {};
  const pieceId = String(body.pieceId ?? '').trim();
  const strokeWidth = Number(body.strokeWidth ?? 1.0);
  if (!pieceId) return res.status(400).json({ error: 'pieceId required' });

  // Authenticate the caller using a bearer token
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  let admin: ReturnType<typeof getAdmin>;
  try {
    admin = getAdmin();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }

  // const { data: who, error: whoErr } = await admin.auth.getUser(token);
  // if (whoErr || !who?.user) {
  //   return res.status(401).json({ error: 'Invalid session' });
  // }

  try {
    // 1. Fetch piece configuration
    const { data: piece, error: pieceErr } = await admin
      .from('pieces')
      .select('*')
      .eq('id', pieceId)
      .maybeSingle();
    if (pieceErr) throw new Error(`Load piece: ${pieceErr.message}`);
    if (!piece) throw new Error(`Piece ${pieceId} not found`);

    // 2. Download segmentation cache JSON from storage
    const cachePath = `${piece.id}/segmentation_cache.json`;
    const dlCache = await admin.storage.from('piece-previews').download(cachePath);
    if (dlCache.error || !dlCache.data) {
      // Cache is missing! Fallback to full generation:
      // 1. Update stroke_width and status to 'queued' in DB
      const { error: updErr } = await admin
        .from('pieces')
        .update({ stroke_width: strokeWidth, status: 'queued', error_message: null } as Record<string, unknown>)
        .eq('id', pieceId);
      if (updErr) {
        if (updErr.message.includes('stroke_width')) {
          return res.status(400).json({ error: "Database column 'stroke_width' is missing. Please run the SQL migration in your Supabase Dashboard." });
        }
        throw new Error(`Update piece fallback: ${updErr.message}`);
      }

      // 2. Clear previous colors
      await admin.from('piece_colors').delete().eq('piece_id', pieceId);

      // 3. Trigger generate endpoint (either forward to Render or run inline)
      const converterUrl = process.env.CONVERTER_URL;
      try {
        if (converterUrl) {
          await fetch(`${converterUrl.replace(/\/$/, '')}/generate`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-converter-secret': process.env.CONVERTER_SECRET ?? '',
            },
            body: JSON.stringify({ pieceId }),
            signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(55_000) : undefined,
          }).catch(() => undefined);
        } else {
          const runJobModule = ['.', '_lib', 'run-job'].join('/');
          const { runGenerationJob } = await import(/* @vite-ignore */ runJobModule) as typeof import('./_lib/run-job');
          runGenerationJob(admin, pieceId).catch((err: any) => {
            console.error(`[regenerate-fallback] inline job failed:`, err);
            admin.from('pieces').update({ status: 'error', error_message: String(err) }).eq('id', pieceId);
          });
        }
      } catch (triggerErr) {
        console.error(`[regenerate-fallback] Failed to trigger job:`, triggerErr);
        await admin.from('pieces').update({ status: 'error', error_message: `Failed to trigger background job: ${String(triggerErr)}` }).eq('id', pieceId);
      }

      return res.status(200).json({ ok: true, queued: true });
    }

    const cacheText = await dlCache.data.text();
    const cache = JSON.parse(cacheText);

    // 3. Update stroke_width in database
    const { error: updErr } = await admin
      .from('pieces')
      .update({ stroke_width: strokeWidth } as Record<string, unknown>)
      .eq('id', pieceId);
    if (updErr) {
      if (updErr.message.includes('stroke_width')) {
        return res.status(400).json({ error: "Database column 'stroke_width' is missing. Please run the SQL migration in your Supabase Dashboard." });
      }
      throw new Error(`Update stroke width: ${updErr.message}`);
    }

    // 4. Download background image if exact_source mode
    const renderMode = piece.render_mode ?? 'painting';
    const sizeMultiplier = piece.size_multiplier ?? 3;
    const fontSize = piece.font_size ?? 12;
    const fontColor = piece.font_color ?? '#1A1A1A';

    let backgroundImageBase64: string | undefined;
    if (renderMode === 'exact_source') {
      const { data: source, error: srcErr } = await admin
        .from('source_images')
        .select('*')
        .eq('id', piece.source_image_id)
        .maybeSingle();
      if (srcErr) throw new Error(`Load source image: ${srcErr.message}`);
      if (!source) throw new Error(`Source image ${piece.source_image_id} not found`);

      const dlSrc = await admin.storage.from('source-images').download(source.storage_path);
      if (dlSrc.error || !dlSrc.data) {
        throw new Error(`Download source image: ${dlSrc.error?.message ?? 'no data'}`);
      }

      const arrayBuffer = await dlSrc.data.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      backgroundImageBase64 = buf.toString('base64');
    }

    // 5. Re-render SVGs using cached renderer
    const unifiedFontSize = renderMode !== 'exact_source';

    const filledSvg = renderSvgCached(
      cache,
      sizeMultiplier,
      /* fill */ renderMode === 'exact_source' ? false : true,
      /* stroke */ renderMode === 'exact_source' ? true : false,
      /* labels */ renderMode === 'exact_source' ? true : false,
      fontSize,
      fontColor,
      strokeWidth,
      unifiedFontSize,
      backgroundImageBase64
    );

    const outlineSvg = renderSvgCached(
      cache,
      sizeMultiplier,
      /* fill */ false,
      /* stroke */ true,
      /* labels */ true,
      fontSize,
      fontColor,
      strokeWidth,
      unifiedFontSize,
      undefined
    );

    // 6. Upload rebuilt SVGs
    const previewPath = piece.preview_svg_path ?? `${piece.id}/filled.svg`;
    const outlinePath = piece.outline_svg_path ?? `${piece.id}/outline.svg`;

    const upPreview = await admin.storage
      .from('piece-previews')
      .upload(previewPath, filledSvg, {
        contentType: 'image/svg+xml',
        upsert: true,
      });
    if (upPreview.error) throw new Error(`Upload preview: ${upPreview.error.message}`);

    const upOutline = await admin.storage
      .from('piece-outlines')
      .upload(outlinePath, outlineSvg, {
        contentType: 'image/svg+xml',
        upsert: true,
      });
    if (upOutline.error) throw new Error(`Upload outline: ${upOutline.error.message}`);

    return res.status(200).json({ ok: true, strokeWidth });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[regenerate] piece ${pieceId} failed:`, err);
    return res.status(500).json({ ok: false, error: message, stack });
  }
}
