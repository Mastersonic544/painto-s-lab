import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let stage = 'canvas';
  try {
    const canvas = await import('canvas');
    const image = canvas.createCanvas(1, 1);
    stage = 'firebase-admin';
    await import('./_lib/admin');
    stage = 'generation-engine';
    await import('./_lib/run-job');
    return res.status(200).json({ ok: true, width: image.width });
  } catch (error) {
    return res.status(500).json({ ok: false, stage, error: error instanceof Error ? error.message : String(error) });
  }
}
