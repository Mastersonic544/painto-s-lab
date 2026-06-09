import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/db';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Phase 1 dev: noisy but non-fatal so the shell still boots without env wired.
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. Copy .env.example to .env and fill them in.',
  );
}

export const supabase = createClient<Database>(
  url || 'http://localhost',
  anonKey || 'anon-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
