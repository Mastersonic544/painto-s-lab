// Service-role Supabase client. Only ever import from /api code —
// never from /src — since this client bypasses RLS.
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/db';

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  // Throw lazily so a deployment without env vars fails the first
  // request with a clear message instead of at cold start.
}

export function getAdmin() {
  if (!url) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
