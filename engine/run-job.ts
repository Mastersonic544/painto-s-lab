// =============================================================
// Painto's Lab — dedicated worker fallback
// Runs the same job logic as /api/generate but without serverless
// time limits. Two modes:
//
//   npm --prefix engine run job -- <pieceId>
//     Process one queued piece by id.
//
//   npm --prefix engine run job -- --poll
//     Long-poll the pieces table for queued rows and process them
//     forever. This is the shape of the worker PRD §5 suggests
//     moving to once serverless timeouts become a regular problem.
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from process.env.
// =============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { runGenerationJob, markPieceError } from '../api/_lib/run-job';
import type { Database } from '../src/types/db';

function getAdmin(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function processOne(admin: SupabaseClient<Database>, pieceId: string) {
  console.log(`[worker] processing ${pieceId}`);
  try {
    const out = await runGenerationJob(admin, pieceId, {
      // Dedicated worker has no 60s ceiling — let it process bigger
      // images without resizing as aggressively.
      resizeMaxEdge: 1024,
    });
    console.log(`[worker] ready in ${out.durationMs}ms: ${out.pieceId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] failed ${pieceId}: ${msg}`);
    await markPieceError(admin, pieceId, msg);
  }
}

async function poll(admin: SupabaseClient<Database>, intervalMs = 3000) {
  console.log(`[worker] polling every ${intervalMs}ms for queued pieces...`);
  while (true) {
    const { data, error } = await admin
      .from('pieces')
      .select('id')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) {
      console.error(`[worker] poll error: ${error.message}`);
    } else if (data && data.length > 0) {
      await processOne(admin, data[0].id);
      continue; // immediately check for another queued piece
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const admin = getAdmin();
  if (args.includes('--poll')) {
    await poll(admin);
    return;
  }
  const pieceId = args[0];
  if (!pieceId) {
    console.error('Usage: tsx engine/run-job.ts <pieceId> | --poll');
    process.exit(1);
  }
  await processOne(admin, pieceId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
