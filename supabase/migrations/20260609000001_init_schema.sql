-- =============================================================
-- Painto's Lab — initial schema
-- Covers PRD §6. Single-tenant Phase 1: one operator role, no
-- customer-facing tables.
-- =============================================================

create extension if not exists "pgcrypto";

-- ----- Enums --------------------------------------------------
create type public.user_role       as enum ('operator');
create type public.piece_status    as enum ('queued', 'ready', 'approved', 'archived');
create type public.piece_mode      as enum ('auto', 'manual');
create type public.piece_complexity as enum ('simple', 'normal', 'complex');
create type public.cart_status     as enum ('open', 'checked_out');
create type public.mix_task_status as enum ('todo', 'done');

-- ----- profiles -----------------------------------------------
-- One row per auth.users entry. Inserted by a trigger on signup
-- so the FK between profiles.id and auth.users(id) stays intact.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  role          public.user_role not null default 'operator',
  created_at    timestamptz      not null default now()
);

-- ----- source_images ------------------------------------------
create table public.source_images (
  id                uuid primary key default gen_random_uuid(),
  storage_path      text not null,                -- key in the source-images bucket
  original_filename text not null,
  uploaded_by       uuid not null references public.profiles(id) on delete restrict,
  created_at        timestamptz not null default now()
);
create index source_images_uploaded_by_idx on public.source_images(uploaded_by);

-- ----- pieces -------------------------------------------------
create table public.pieces (
  id                uuid primary key default gen_random_uuid(),
  source_image_id   uuid not null references public.source_images(id) on delete restrict,
  title             text not null,
  status            public.piece_status     not null default 'queued',
  mode              public.piece_mode       not null default 'auto',
  complexity        public.piece_complexity not null default 'normal',
  color_count       int  not null check (color_count > 0),
  canvas_width_cm   numeric(7,2) not null default 40,
  canvas_height_cm  numeric(7,2) not null default 50,
  -- PRD §7: acrylics commonly want two coats for opacity.
  coats             int  not null default 2 check (coats > 0),
  preview_svg_path  text,                          -- key in piece-previews bucket
  outline_svg_path  text,                          -- key in piece-outlines bucket
  palette_json      jsonb,                         -- the canonical palette array
  created_at        timestamptz not null default now(),
  approved_at       timestamptz
);
create index pieces_status_idx       on public.pieces(status);
create index pieces_source_image_idx on public.pieces(source_image_id);

-- ----- piece_colors -------------------------------------------
-- Derived from palette_json. One row per palette entry.
create table public.piece_colors (
  id                  uuid primary key default gen_random_uuid(),
  piece_id            uuid not null references public.pieces(id) on delete cascade,
  color_index         int  not null check (color_index >= 0),
  label               text,
  rgb_hex             text not null check (rgb_hex ~* '^#[0-9a-f]{6}$'),
  area_percentage     numeric(8,6) not null check (area_percentage >= 0 and area_percentage <= 1),
  estimated_volume_ml numeric(10,2) not null check (estimated_volume_ml >= 0),
  unique (piece_id, color_index)
);
create index piece_colors_piece_idx on public.piece_colors(piece_id);
create index piece_colors_hex_idx   on public.piece_colors(rgb_hex);

-- ----- base_paints --------------------------------------------
-- Physical containers the operator stocks. Source of truth for mixing.
create table public.base_paints (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null unique,
  rgb_hex                text not null check (rgb_hex ~* '^#[0-9a-f]{6}$'),
  container_capacity_ml  numeric(10,2) not null check (container_capacity_ml > 0),
  current_level_ml       numeric(10,2) not null default 0
    check (current_level_ml >= 0),
  reorder_threshold_ml   numeric(10,2) not null default 0
    check (reorder_threshold_ml >= 0),
  created_at             timestamptz not null default now()
);

-- ----- color_recipes ------------------------------------------
-- Reusable across pieces, keyed by target color. is_verified flips
-- true once the operator confirms the real-world mix (PRD §8).
create table public.color_recipes (
  id              uuid primary key default gen_random_uuid(),
  target_rgb_hex  text not null unique
    check (target_rgb_hex ~* '^#[0-9a-f]{6}$'),
  recipe_json     jsonb not null,        -- [{ base_paint_id, parts | ml }, ...]
  is_verified     boolean not null default false,
  notes           text,
  updated_at      timestamptz not null default now()
);
create index color_recipes_verified_idx on public.color_recipes(is_verified);

-- Touch updated_at on any change.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger color_recipes_touch
  before update on public.color_recipes
  for each row execute function public.touch_updated_at();

-- ----- carts --------------------------------------------------
create table public.carts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  status          public.cart_status not null default 'open',
  created_at      timestamptz not null default now(),
  checked_out_at  timestamptz
);
create index carts_status_idx on public.carts(status);

-- ----- cart_items ---------------------------------------------
create table public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  cart_id    uuid not null references public.carts(id) on delete cascade,
  piece_id   uuid not null references public.pieces(id) on delete restrict,
  quantity   int not null default 1 check (quantity > 0),
  unique (cart_id, piece_id)
);
create index cart_items_cart_idx on public.cart_items(cart_id);

-- ----- mix_tasks ----------------------------------------------
-- One per target color in a checked-out cart.
create table public.mix_tasks (
  id                uuid primary key default gen_random_uuid(),
  cart_id           uuid not null references public.carts(id) on delete cascade,
  target_rgb_hex    text not null check (target_rgb_hex ~* '^#[0-9a-f]{6}$'),
  target_volume_ml  numeric(10,2) not null check (target_volume_ml >= 0),
  recipe_id         uuid references public.color_recipes(id) on delete set null,
  status            public.mix_task_status not null default 'todo',
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  unique (cart_id, target_rgb_hex)
);
create index mix_tasks_cart_idx   on public.mix_tasks(cart_id);
create index mix_tasks_status_idx on public.mix_tasks(status);
