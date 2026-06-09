-- =============================================================
-- Painto's Lab — storage buckets and policies
-- Three private buckets matching the RLS model: only operators
-- can read or write. PRD §6.
-- =============================================================

insert into storage.buckets (id, name, public)
values
  ('source-images',  'source-images',  false),
  ('piece-previews', 'piece-previews', false),
  ('piece-outlines', 'piece-outlines', false)
on conflict (id) do nothing;

-- Drop any prior policy with the same name so this migration is
-- safe to re-run during dev. (Storage allows duplicate names per
-- (bucket_id, name) so we scope by name.)
do $$
declare
  pname text;
  names text[] := array[
    'painto_select_source',  'painto_insert_source',  'painto_update_source',  'painto_delete_source',
    'painto_select_preview', 'painto_insert_preview', 'painto_update_preview', 'painto_delete_preview',
    'painto_select_outline', 'painto_insert_outline', 'painto_update_outline', 'painto_delete_outline'
  ];
begin
  foreach pname in array names loop
    execute format('drop policy if exists %I on storage.objects', pname);
  end loop;
end $$;

-- source-images
create policy painto_select_source on storage.objects
  for select to authenticated
  using (bucket_id = 'source-images' and public.is_operator());
create policy painto_insert_source on storage.objects
  for insert to authenticated
  with check (bucket_id = 'source-images' and public.is_operator());
create policy painto_update_source on storage.objects
  for update to authenticated
  using (bucket_id = 'source-images' and public.is_operator())
  with check (bucket_id = 'source-images' and public.is_operator());
create policy painto_delete_source on storage.objects
  for delete to authenticated
  using (bucket_id = 'source-images' and public.is_operator());

-- piece-previews
create policy painto_select_preview on storage.objects
  for select to authenticated
  using (bucket_id = 'piece-previews' and public.is_operator());
create policy painto_insert_preview on storage.objects
  for insert to authenticated
  with check (bucket_id = 'piece-previews' and public.is_operator());
create policy painto_update_preview on storage.objects
  for update to authenticated
  using (bucket_id = 'piece-previews' and public.is_operator())
  with check (bucket_id = 'piece-previews' and public.is_operator());
create policy painto_delete_preview on storage.objects
  for delete to authenticated
  using (bucket_id = 'piece-previews' and public.is_operator());

-- piece-outlines
create policy painto_select_outline on storage.objects
  for select to authenticated
  using (bucket_id = 'piece-outlines' and public.is_operator());
create policy painto_insert_outline on storage.objects
  for insert to authenticated
  with check (bucket_id = 'piece-outlines' and public.is_operator());
create policy painto_update_outline on storage.objects
  for update to authenticated
  using (bucket_id = 'piece-outlines' and public.is_operator())
  with check (bucket_id = 'piece-outlines' and public.is_operator());
create policy painto_delete_outline on storage.objects
  for delete to authenticated
  using (bucket_id = 'piece-outlines' and public.is_operator());
