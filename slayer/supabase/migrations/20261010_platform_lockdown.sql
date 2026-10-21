-- ==================================================
--   SLAYER TERMINAL - THE PLATFORM'S OWN HELPER, OFF THE API
--   (supabase/migrations/20261010_platform_lockdown.sql)
--
--   Supabase puts a helper of its own in the public
--   schema, rls_auto_enable() — an event trigger that
--   switches row-level security on for every new table.
--   It too runs as SECURITY DEFINER and, like any public
--   function, is callable from the browser as an RPC.
--   An event trigger needs no EXECUTE to fire, so the
--   browser's roles lose it. Guarded: a project without
--   the helper has nothing to revoke. Run after
--   20261010_rls_initplan.sql.
-- ==================================================

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
