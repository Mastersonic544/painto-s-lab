# Database Progress Log

### 2026-07-08 — exact_source_render_mode
Change: Alter pieces.render_mode constraint to allow 'exact_source' and add stroke_width column.
SQL:
```sql
alter table public.pieces
  drop constraint if exists pieces_render_mode_check;

alter table public.pieces
  add constraint pieces_render_mode_check
    check (render_mode in ('painting', 'portrait', 'exact_source'));

alter table public.pieces
  add column if not exists stroke_width numeric not null default 1.0;
```
Reason: Support the new 'Exact Source' render mode and custom outline stroke widths per piece.
Status: APPLIED
