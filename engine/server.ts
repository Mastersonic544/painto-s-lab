// =============================================================
// Painto's Lab — converter backend (Render web service)
// A long-running Node service that runs the heavy conversion
// pipeline with no serverless time limit. It is the production
// home of the worker the PRD (§5) anticipated.
//
// Flow: Vercel's /api/generate authenticates the operator, then
// forwards { pieceId } here with a shared secret. We ack 202
// immediately and run the job in the background, flipping the
// piece to 'ready' (or 'error') when done. The frontend watches
// piece status via Realtime/poll, so nothing waits on this call.
//
// Run locally:  CONVERTER_SECRET=dev npm run converter
// Deploy:       see render.yaml
// =============================================================

import express from 'express';
import { getAdmin } from '../api/_lib/admin';
import { runGenerationJob, markPieceError } from '../api/_lib/run-job';

const app = express();
app.use(express.json({ limit: '1mb' }));

const SECRET = process.env.CONVERTER_SECRET ?? '';

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'paintos-converter' });
});

app.post('/generate', (req, res) => {
  if (!SECRET || req.header('x-converter-secret') !== SECRET) {
    return res.status(401).json({ error: 'bad or missing converter secret' });
  }
  const pieceId = String((req.body as { pieceId?: unknown })?.pieceId ?? '').trim();
  if (!pieceId) return res.status(400).json({ error: 'pieceId required' });

  // Resolve the admin client up front so a misconfiguration is a clean 500
  // rather than an unhandled rejection after we've already acked.
  let admin: ReturnType<typeof getAdmin>;
  try {
    admin = getAdmin();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }

  // Ack now; do the heavy lifting after the response is sent.
  res.status(202).json({ ok: true, accepted: pieceId });

  runGenerationJob(admin, pieceId)
    .then((r) => console.log(`[converter] done ${pieceId} in ${r.durationMs}ms (${r.paletteSize} colors)`))
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[converter] ${pieceId} failed:`, msg);
      await markPieceError(admin, pieceId, msg);
    });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[converter] listening on :${port}`);
});
