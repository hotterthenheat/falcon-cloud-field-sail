-- ==================================================
--   SLAYER TERMINAL - THE PLAN'S STANDING, FROM STRIPE
--   (supabase/migrations/20261011_billing.sql)
--
--   Stripe in test mode (Noah, 2026-10-10). What a
--   payment leaves on the account:
--
--   FIVE COLUMNS   on profiles — Stripe's customer and
--                  subscription ids, the plan's standing
--                  (plan_status), its period (month ·
--                  year) and when it renews or ends.
--                  `plan` itself already exists; Stripe
--                  sets it now, by hand stays possible.
--   THE GUARD      the five move only under an owner or
--                  with no signed-in user (the dashboard,
--                  Stripe's function) — a member's own
--                  row update cannot forge them.
--   THE LOG        plan_status changes are logged too.
--   STRIPE'S DOOR  billing_apply(...) — the one function
--                  the webhook calls, service role only:
--                  the whole standing in one update, the
--                  reason riding into the log.
--
--   Run after 20261011_admin_people.sql.
-- ==================================================

alter table public.profiles
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text,
  add column if not exists plan_status            text not null default 'none',
  add column if not exists plan_period            text,
  add column if not exists plan_renews_on         timestamptz;
create unique index if not exists profiles_stripe_customer on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
alter table public.profiles drop constraint if exists profiles_plan_status_check;
alter table public.profiles
  add constraint profiles_plan_status_check check (plan_status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'));
alter table public.profiles drop constraint if exists profiles_plan_period_check;
alter table public.profiles
  add constraint profiles_plan_period_check check (plan_period is null or plan_period in ('month', 'year'));

-- THE GUARD, WIDENED: the billing columns beside role, plan and the ban
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
       or new.banned_until is distinct from old.banned_until
       or new.plan_status is distinct from old.plan_status
       or new.plan_period is distinct from old.plan_period
       or new.plan_renews_on is distinct from old.plan_renews_on
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id then
      raise exception 'only an owner may change role, plan, billing or banned_until';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- THE LOG: the plan's standing too
create or replace function public.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid := auth.uid();
  why text := nullif(current_setting('slayer.note', true), '');
begin
  if new.plan is distinct from old.plan then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'plan', old.plan, new.plan, why);
  end if;
  if new.plan_status is distinct from old.plan_status then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'plan_status', old.plan_status, new.plan_status, why);
  end if;
  if new.role is distinct from old.role then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'role', old.role, new.role, why);
  end if;
  if new.banned_until is distinct from old.banned_until then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'banned_until', old.banned_until::text, new.banned_until::text, why);
  end if;
  return new;
end;
$$;

-- STRIPE'S DOOR: the whole standing in one update, the reason into the log; the service role only
create or replace function public.billing_apply(
  subject uuid, p_plan text, p_status text, p_period text, p_renews_on timestamptz, p_customer text, p_subscription text, note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('slayer.note', coalesce(nullif(trim(note), ''), 'Stripe'), true);
  update public.profiles
     set plan                   = coalesce(p_plan, plan),
         plan_status            = coalesce(p_status, plan_status),
         plan_period            = p_period,
         plan_renews_on         = p_renews_on,
         stripe_customer_id     = coalesce(p_customer, stripe_customer_id),
         stripe_subscription_id = coalesce(p_subscription, stripe_subscription_id)
   where id = subject;
end;
$$;
revoke execute on function public.billing_apply(uuid, text, text, text, timestamptz, text, text, text) from public, anon, authenticated;

-- the admin list carries the standing too
drop function if exists public.admin_people();
create or replace function public.admin_people()
returns table (
  id uuid, email text, name text, handle text, avatar text, role text, plan text, banned_until timestamptz,
  created_at timestamptz, updated_at timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz, providers text[],
  plan_status text, plan_period text, plan_renews_on timestamptz, stripe_customer_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'owners only';
  end if;
  return query
    select p.id, p.email, p.name, p.handle, p.avatar, p.role, p.plan, p.banned_until, p.created_at, p.updated_at,
           u.last_sign_in_at, u.email_confirmed_at,
           coalesce((select array_agg(i.provider::text order by i.provider) from auth.identities i where i.user_id = p.id), '{}'::text[]),
           p.plan_status, p.plan_period, p.plan_renews_on, p.stripe_customer_id
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;
revoke execute on function public.admin_people() from public, anon;
