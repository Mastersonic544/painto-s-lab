-- Alter pieces.render_mode constraint to allow 'exact_source' and add stroke_width column
alter table public.pieces
  drop constraint if exists pieces_render_mode_check;

alter table public.pieces
  add constraint pieces_render_mode_check
    check (render_mode in ('painting', 'portrait', 'exact_source'));

alter table public.pieces
  add column if not exists stroke_width numeric not null default 1.0;
