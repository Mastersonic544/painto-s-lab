import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Phase 1 dev: noisy but non-fatal so the shell still boots without env wired.
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. Copy .env.example to .env and fill them in.',
  );
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon-placeholder');
