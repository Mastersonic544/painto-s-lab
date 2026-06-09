import { ReactNode } from 'react';

// Auth gate stub — Phase 1 wiring placeholder. Real check (Supabase session)
// lands with the Auth feature module. For now everything is allowed through so
// /app routes render the shell.
export default function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthed = true;
  if (!isAuthed) return null;
  return <>{children}</>;
}
