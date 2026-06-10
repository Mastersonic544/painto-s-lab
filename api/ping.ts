// Diagnostic: a serverless function with NO imports beyond the type-only
// Vercel types. If /api/ping works but /api/decide-complexity 500s, the crash
// is in the @supabase/getAdmin import chain — not the runtime itself.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ pong: true, node: process.version });
}
