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
import { runGenerationJob, markPieceError } from './_lib/run-job';
import type { Database } from '../src/types/db';

export const config = {
  // 60s is Vercel Pro's ceiling. Hobby caps at 10s, which is not
  // enough for the engine on anything but tiny images — keep the
  // dedicated worker path in engine/run-job.ts as the escape hatch.
  maxDuration: 60,
};

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

  try {
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
