-- ==================================================
--   SLAYER TERMINAL - THE DASHBOARD IS THE OWNERS' DOOR
--   (supabase/migrations/20261010_protect_dashboard.sql)
--
--   The first owners' update (Noah, 2026-10-10) was
--   refused by profiles_protect: the SQL editor runs
--   with no signed-in user, so auth.uid() is null and
--   is_owner() says no — the rule meant for the browser
--   barred the dashboard. A caller with no user is the
--   dashboard (the browser always carries one, and the
--   row policies already keep anon out), so the rule
--   lets it through. Run after 20261005_plan_tape.sql.
-- ==================================================

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_owner() then
    if new.role is distinct from old.role
       or new.plan is distinct from old.plan
       or new.banned_until is distinct from old.banned_until then
      raise exception 'only an owner may change role, plan or banned_until';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
