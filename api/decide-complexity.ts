// =============================================================
// Painto's Lab — /api/decide-complexity (PRD §4)
// Downloads a queued source image from the source-images bucket
// and asks an OpenRouter vision model to rate its complexity and
// suggest a color count. The client also computes an algorithmic
// score in parallel — failures here are intentionally non-fatal,
// the algorithmic fallback covers them.
// =============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdmin } from './_lib/admin';

export const config = {
  // Plenty: vision API round-trip dominates and is usually <10s.
  maxDuration: 30,
};

type Tier = 'simple' | 'normal' | 'complex';

const DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {};
  const sourceImageId = String(body.sourceImageId ?? '').trim();
  if (!sourceImageId) return res.status(400).json({ error: 'sourceImageId required' });

  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  // Verify the caller with the service-role client — no anon key needed.
  let admin: ReturnType<typeof getAdmin>;
  try {
    admin = getAdmin();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return res.status(401).json({ error: 'Invalid session' });

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    return res
      .status(503)
      .json({ error: 'OPENROUTER_API_KEY not configured — use algorithmic fallback' });
  }

  try {
    const { data: source, error: srcErr } = await admin
      .from('source_images')
      .select('*')
      .eq('id', sourceImageId)
      .maybeSingle();
    if (srcErr || !source) {
      return res.status(404).json({ error: srcErr?.message ?? 'source image not found' });
    }

    const dl = await admin.storage.from('source-images').download(source.storage_path);
    if (dl.error || !dl.data) {
      return res.status(500).json({ error: `download: ${dl.error?.message ?? 'no data'}` });
    }
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const mime = guessMime(source.original_filename);
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

    const model = process.env.OPENROUTER_VISION_MODEL ?? DEFAULT_MODEL;
    const decision = await askOpenRouter(openrouterKey, model, dataUrl);
    return res.status(200).json({ ok: true, model, ...decision });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[decide-complexity] failed:', err);
    // Soft 200 with model=null lets the client cleanly fall through to its
    // algorithmic score without treating this as a UI-level failure.
    return res.status(200).json({ ok: false, error: msg });
  }
}

async function askOpenRouter(
  apiKey: string,
  model: string,
  dataUrl: string,
): Promise<{ tier: Tier; suggestedCount: number; reason: string }> {
  const prompt =
    'You are advising on a paint-by-numbers conversion of this image. ' +
    'Rate its complexity for that purpose and suggest a target color count.\n\n' +
    'Tiers: "simple" (~8 colors, flat illustrations, low edge density), ' +
    '"normal" (~16 colors, balanced photos/paintings), ' +
    '"complex" (~32 colors, busy photographs, lots of fine detail).\n\n' +
    'Respond with a single JSON object — no prose, no markdown fences — with exactly:\n' +
    '{ "tier": "simple"|"normal"|"complex", ' +
    '"suggestedCount": integer between 6 and 48, ' +
    '"reason": short one-sentence explanation }\n\n' +
    'Round up when in doubt: an over-colored kit is better than a sparse one.';

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://paintos.lab',
      'X-Title': "Painto's Lab",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '<no body>');
    throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? '';
  const parsed = extractJson(content);
  if (!parsed) throw new Error(`Could not parse model response: ${content.slice(0, 200)}`);
  const tier = normaliseTier(parsed.tier);
  const suggestedCount = Math.max(2, Math.min(64, Number(parsed.suggestedCount) || 16));
  const reason = String(parsed.reason ?? '').slice(0, 280);
  return { tier, suggestedCount, reason };
}

function normaliseTier(value: unknown): Tier {
  const s = String(value ?? '').toLowerCase().trim();
  if (s === 'simple' || s === 'normal' || s === 'complex') return s;
  // Be forgiving: some models hedge with "moderate" / "intermediate".
  if (s.includes('simple') || s.includes('low') || s.includes('flat')) return 'simple';
  if (s.includes('complex') || s.includes('high') || s.includes('busy')) return 'complex';
  return 'normal';
}

// Models sometimes wrap JSON in ```json fences or prose. Strip both.
function extractJson(text: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fence) candidates.push(fence[1]);
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);
  candidates.push(text);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object') return v as Record<string, unknown>;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}
