// Diagnostic: STATIC named import of @supabase (the exact pattern admin.ts
// uses). If this function crashes (FUNCTION_INVOCATION_FAILED) while the
// dynamic-import version worked, the static ESM/CJS interop is the culprit.
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, node: process.version, createClient: typeof createClient });
}
