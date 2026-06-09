-- =============================================================
-- Painto's Lab — RLS policies
-- Phase 1 is single-tenant: every authenticated user with the
-- 'operator' role can read and write every row. Anon clients
-- get nothing. PRD §2, §6.
-- =============================================================

-- A SECURITY DEFINER helper so policies don't recurse through
-- profiles' own RLS. Lives in public so it's reachable from RLS.
create or replace function public.is_operator()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'operator'
  );
$$;

revoke all on function public.is_operator() from public;
grant execute on function public.is_operator() to authenticated;

-- ----- Enable RLS on every public table -----------------------
alter table public.profiles       enable row level security;
alter table public.source_images  enable row level security;
alter table public.pieces         enable row level security;
alter table public.piece_colors   enable row level security;
alter table public.base_paints    enable row level security;
alter table public.color_recipes  enable row level security;
alter table public.carts          enable row level security;
alter table public.cart_items     enable row level security;
alter table public.mix_tasks      enable row level security;

-- ----- profiles -----------------------------------------------
-- A user can always see and update their own profile row. This
-- bootstraps the is_operator() check without recursion: the user
-- can read the row that proves they're an operator. We do NOT
-- allow self-insert (the auth trigger handles it) or self-delete.
create policy "profiles_self_select" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

create policy "profiles_self_update" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id and role = 'operator');

-- ----- Generic operator policy macro --------------------------
-- For every other table: operator can do anything; nobody else
-- can see or touch a row.
do $$
declare
  t text;
  tables text[] := array[
    'source_images',
    'pieces',
    'piece_colors',
    'base_paints',
    'color_recipes',
    'carts',
    'cart_items',
    'mix_tasks'
  ];
begin
  foreach t in array tables loop
    execute format($f$
      create policy "%1$s_operator_select" on public.%1$I
        for select to authenticated using (public.is_operator());
    $f$, t);
    execute format($f$
      create policy "%1$s_operator_insert" on public.%1$I
        for insert to authenticated with check (public.is_operator());
    $f$, t);
    execute format($f$
      create policy "%1$s_operator_update" on public.%1$I
        for update to authenticated
        using (public.is_operator()) with check (public.is_operator());
    $f$, t);
    execute format($f$
      create policy "%1$s_operator_delete" on public.%1$I
        for delete to authenticated using (public.is_operator());
    $f$, t);
  end loop;
end $$;
