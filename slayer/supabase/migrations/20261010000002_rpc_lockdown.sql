-- ==================================================
--   SLAYER TERMINAL - THE TRIGGERS ARE NOT DOORS
--   (supabase/migrations/20261010_rpc_lockdown.sql)
--
--   The project's security advisor (read through the
--   Supabase connector, 2026-10-10): every function in
--   the public schema is callable from the browser as
--   an RPC, and these run as SECURITY DEFINER. The three
--   trigger functions are fired by the database itself
--   (a trigger needs no EXECUTE at firing time, only at
--   its creation), so nobody in the browser needs to
--   call them: EXECUTE is taken back from the browser's
--   roles. is_owner() stays callable by a signed-in
--   user ON PURPOSE — the row policies evaluate it as
--   the signed-in user, and it answers only about them.
--   Run after 20261010_protect_dashboard.sql.
-- ==================================================

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email() from public, anon, authenticated;
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;
revoke execute on function public.is_owner() from public, anon;
