import { getAdmin, verifyToken } from '../../api/_lib/admin';
import { runGenerationJob, markPieceError } from '../../api/_lib/run-job';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Generation runs on Vercel so Painto does not depend on a separate converter host.
export const config = { maxDuration: 300 };

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; }
  catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {};
  const pieceId = String(body.pieceId ?? '').trim();
  if (!pieceId) return res.status(400).json({ error: 'pieceId required' });

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  let admin: ReturnType<typeof getAdmin>;
  try {
    const uid = await verifyToken(token);
    admin = getAdmin(uid);
  } catch (err) {
    return res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid session' });
  }

  const piece = await admin.from('pieces').select('id').eq('id', pieceId).maybeSingle();
  if (piece.error) return res.status(500).json({ error: piece.error.message });
  if (!piece.data) return res.status(404).json({ error: 'Piece not found' });

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
