# Supabase migrations

Single-tenant Phase 1 setup. Order matters — apply in filename order.

## Apply with Supabase CLI

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## Apply manually

Open the SQL editor in the Supabase dashboard and paste each file in order:

1. `migrations/20260609000001_init_schema.sql` — enums, tables, indexes
2. `migrations/20260609000002_auth_trigger.sql` — auto-create a profile on signup
3. `migrations/20260609000003_rls_policies.sql` — RLS + `is_operator()` helper
4. `migrations/20260609000004_storage.sql` — buckets and storage policies

## Regenerate TypeScript types

`src/types/db.ts` is hand-written to match the schema above. To switch to
generated types later:

```bash
supabase gen types typescript --linked > src/types/db.ts
```

## Operator bootstrap

In Phase 1 there is no signup UI — sign-in is magic-link only. Create the
first operator from the dashboard (Authentication → Add user) or run, in the
SQL editor:

```sql
-- The auth trigger handles inserting a profiles row.
select extensions.uuid_generate_v4();  -- just to nudge auth schema, optional
-- then: invite or add the user via the Auth UI.
```
