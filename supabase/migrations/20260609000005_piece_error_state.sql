-- =============================================================
-- Painto's Lab — piece error state
-- Extends piece_status with 'error' and adds a free-form
-- error_message so the generation pipeline can surface failures
-- to the operator without making up an ad-hoc status convention.
-- =============================================================

-- ALTER TYPE ... ADD VALUE cannot run inside a transaction in
-- older Postgres, but it works fine on Supabase's managed PG.
alter type public.piece_status add value if not exists 'error';

alter table public.pieces
  add column if not exists error_message text;
