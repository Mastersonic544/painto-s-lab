// =============================================================
// Painto's Lab — /api/generate
// Vercel serverless trigger for the conversion engine. The actual
// work lives in api/_lib/run-job.ts so the same code path can run
// from engine/run-job.ts as a dedicated long-running worker
// (PRD §5: "move the worker to a dedicated queue and long-running
// process" when serverless time limits start to bite).
// =============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getAdmin } from './_lib/admin';
import type { Database } from '../src/types/db';

export const config = {
  // This function only authenticates and forwards to the Render converter,
  // so it's fast — 10s is plenty and keeps it within the Hobby cap. The heavy
  // engine work runs on the long-running backend (engine/server.ts).
  maxDuration: 10,
};

// Lightweight failure write — kept here (not imported from run-job) so this
// function never pulls the engine/native canvas into its bundle/cold start.
async function markPieceError(
  admin: ReturnType<typeof getAdmin>,
  pieceId: string,
  message: string,
): Promise<void> {
  try {
    await admin
      .from('pieces')
      .update({ status: 'error', error_message: message.slice(0, 1000) })
      .eq('id', pieceId);
  } catch {
    // best-effort
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {};
  const pieceId = String(body.pieceId ?? '').trim();
  if (!pieceId) return res.status(400).json({ error: 'pieceId required' });

  // Authenticate the caller. We use the service-role client to do
  // the actual work, but we want to refuse anonymous invocations.
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return res.status(500).json({ error: 'Supabase URL or anon key not configured' });
  }
  const userClient = createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await userClient.auth.getUser(token);
  if (whoErr || !who?.user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const admin = getAdmin();

  // Production path: hand the heavy job to the long-running converter
  // (Render) so it never hits the serverless timeout. The frontend tracks
  // the piece via Realtime/poll, so we just need the worker to accept it.
  const converterUrl = process.env.CONVERTER_URL;
  if (converterUrl) {
    try {
      const resp = await fetch(`${converterUrl.replace(/\/$/, '')}/generate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-converter-secret': process.env.CONVERTER_SECRET ?? '',
        },
        body: JSON.stringify({ pieceId }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`converter ${resp.status}: ${text.slice(0, 200)}`);
      }
      return res.status(202).json({ ok: true, forwarded: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[generate] forward to converter failed for ${pieceId}:`, message);
      await markPieceError(admin, pieceId, message);
      return res.status(502).json({ ok: false, error: message });
    }
  }

  // Local / no external converter: run inline (works via the Vite dev bridge).
  // Imported dynamically so the engine + native canvas only load on this path
  // — never when forwarding (production), which keeps the Vercel bundle lean.
  try {
    const { runGenerationJob } = await import('./_lib/run-job');
    const result = await runGenerationJob(admin, pieceId);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[generate] piece ${pieceId} failed:`, err);
    await markPieceError(admin, pieceId, message);
    return res.status(500).json({ ok: false, error: message });
  }
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}
