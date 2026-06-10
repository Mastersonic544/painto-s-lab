// Service-role Supabase client. Only ever import from /api code —
// never from /src — since this client bypasses RLS.
//
// NOTE: deliberately no `import type { Database } from '../../src/types/db'`.
// That cross-directory type import (api -> frontend src) breaks Vercel's
// function bundler at runtime (FUNCTION_INVOCATION_FAILED). The admin client
// is left untyped here; typed callers cast as needed.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getAdmin() {
  if (!url) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
