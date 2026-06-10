-- =============================================================
-- Painto's Lab — per-piece render mode
-- 'painting' = the original facet/k-means pipeline (good for most art).
-- 'portrait' = tuned for faces: perceptual (LAB) clustering, a contrast
-- pre-pass, and smaller facets so features like eyes survive instead of
-- flattening into one blob.
-- =============================================================

alter table public.pieces
  add column if not exists render_mode text not null default 'painting'
    check (render_mode in ('painting', 'portrait'));
