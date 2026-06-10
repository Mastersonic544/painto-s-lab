// Diagnostic: dynamically import @supabase/supabase-js inside a try/catch so
// the REAL error surfaces as JSON instead of a generic FUNCTION_INVOCATION_FAILED.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const mod = await import('@supabase/supabase-js');
    const client = mod.createClient('https://example.supabase.co', 'anon-key');
    res.status(200).json({
      ok: true,
      node: process.version,
      createClient: typeof mod.createClient,
      client: typeof client,
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      node: process.version,
      message: e instanceof Error ? e.message : String(e),
      stack: String(e instanceof Error ? e.stack : '').slice(0, 1000),
    });
  }
}
