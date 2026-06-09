-- =============================================================
-- Painto's Lab — seed basic acrylic base paints (placeholders)
-- A small, gamut-spanning starter set so recipe estimates work
-- out of the box. Idempotent: `name` is unique, so re-running
-- leaves existing paints (and their levels) untouched.
-- Mirrors src/lib/basePaints.ts BASIC_ACRYLICS.
-- =============================================================

insert into public.base_paints
  (name, rgb_hex, container_capacity_ml, current_level_ml, reorder_threshold_ml)
values
  ('Titanium White',        '#f7f7f2', 500, 500, 100),
  ('Mars Black',            '#1b1b1b', 500, 500, 100),
  ('Primary Yellow',        '#f5c518', 500, 500, 100),
  ('Yellow Ochre',          '#c9a227', 500, 500, 100),
  ('Cadmium Red',           '#d32e1f', 500, 500, 100),
  ('Quinacridone Magenta',  '#9b2d5e', 500, 500, 100),
  ('Ultramarine Blue',      '#2b3a8c', 500, 500, 100),
  ('Phthalo Blue',          '#0b4f8a', 500, 500, 100),
  ('Phthalo Green',         '#0b6b5b', 500, 500, 100),
  ('Burnt Umber',           '#5a3a24', 500, 500, 100)
on conflict (name) do nothing;
