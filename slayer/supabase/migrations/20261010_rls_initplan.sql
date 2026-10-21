-- ==================================================
--   SLAYER TERMINAL - THE POLICIES ASK ONCE A QUERY
--   (supabase/migrations/20261010_rls_initplan.sql)
--
--   The project's performance advisor (2026-10-10):
--   a policy written `auth.uid()` asks the function
--   again for EVERY ROW it filters; wrapped in a
--   sub-select Postgres asks once a query and keeps the
--   answer. The same policies, the same rules, written
--   that way. Run after 20261010_rpc_lockdown.sql.
-- ==================================================

drop policy if exists "profiles: read own, owners read all" on public.profiles;
create policy "profiles: read own, owners read all"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_owner()));

drop policy if exists "profiles: update own, owners update all" on public.profiles;
create policy "profiles: update own, owners update all"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()) or (select public.is_owner()))
  with check (id = (select auth.uid()) or (select public.is_owner()));
