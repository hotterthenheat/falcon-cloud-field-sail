-- ====================================================================================================================
--   SLAYER TERMINAL - ROLES AND GRANTS (supabase/migrations/20261017_roles_grants.sql)
--
--   Noah, 2026-10-17, with his partner: "make more roles … legacy (for people we give it to for free) … the ability to
--   make him an owner from the slayer account". The shape taken (and agreed, "build it"):
--
--   A ROLE says who someone is to the company; A PLAN says what they can see. They stay apart.
--
--     roles    owner   runs the terminal — People, the log, every door
--              team    a staff seat — reads People and the log, changes nothing (support, without the owner login)
--              member  a trader
--
--     grants   grant_plan + grant_until + grant_note   a complimentary plan — "legacy" — given by an owner, never
--                                                      touching Stripe; the person keeps their role, their Account
--                                                      page says "with our thanks", the plan gates read the higher
--                                                      of the grant and anything paid. It CARRIES AN END even when
--                                                      "forever" is meant (set far out): a date you can see beats a
--                                                      silent lifetime.
--              beta                                    opens rooms still behind the coming-soon wall for this person
--
--   The rules the database keeps: owners alone change anything here; the last owner stays; nobody bans themselves;
--   every change writes the log with who did it and why. The Stripe webhook writes plan and plan_status through
--   billing_apply and never these columns, so a grant cannot be overwritten by a payment's news.
-- ====================================================================================================================

-- THE ROLES -------------------------------------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('owner', 'team', 'member'));

-- THE GRANTS ------------------------------------------------------------------------------------------------------
alter table public.profiles
  add column if not exists grant_plan  text,
  add column if not exists grant_until timestamptz,
  add column if not exists grant_note  text,
  add column if not exists beta        boolean not null default false;
alter table public.profiles drop constraint if exists profiles_grant_plan_check;
alter table public.profiles
  add constraint profiles_grant_plan_check check (grant_plan is null or grant_plan in ('book', 'tape', 'desk', 'seat'));
comment on column public.profiles.grant_plan  is 'A complimentary plan given by an owner — "legacy"; the gates read the higher of this and the paid plan while grant_until has not passed.';
comment on column public.profiles.grant_until is 'When the grant ends — always set; "forever" is a date far out.';
comment on column public.profiles.grant_note  is 'Why it was given, in the owner''s words — the People card shows it to owners; the person''s own page says only "with our thanks".';
comment on column public.profiles.beta        is 'Opens rooms still behind the coming-soon wall for this person.';

-- WHO READS THE ROOM: owners and the team ----------------------------------------------------------------------------
create or replace function public.is_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner', 'team'));
$$;
revoke execute on function public.is_team() from public, anon;
grant execute on function public.is_team() to authenticated;

drop policy if exists "audit_log: owners read" on public.audit_log;
drop policy if exists "audit_log: owners and team read" on public.audit_log;
create policy "audit_log: owners and team read"
  on public.audit_log for select
  to authenticated
  using ((select public.is_team()));

-- THE GUARD, WIDENED: the grants and beta beside role, plan, billing and the ban ------------------------------------
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
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.grant_plan is distinct from old.grant_plan
       or new.grant_until is distinct from old.grant_until
       or new.grant_note is distinct from old.grant_note
       or new.beta is distinct from old.beta then
      raise exception 'only an owner may change role, plan, billing, grants or banned_until';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- THE LOG, WIDENED: a grant given, moved or taken; beta on or off ----------------------------------------------------
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
  if new.grant_plan is distinct from old.grant_plan then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'grant_plan', old.grant_plan, new.grant_plan, why);
  end if;
  if new.grant_until is distinct from old.grant_until then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'grant_until', old.grant_until::text, new.grant_until::text, why);
  end if;
  if new.beta is distinct from old.beta then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'beta', old.beta::text, new.beta::text, why);
  end if;
  return new;
end;
$$;

-- THE LIST, WITH THE GRANTS — owners and the team read it ------------------------------------------------------------
drop function if exists public.admin_people();
create function public.admin_people()
returns table (
  id uuid, email text, name text, handle text, avatar text, role text, plan text, banned_until timestamptz,
  created_at timestamptz, updated_at timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz, providers text[],
  plan_status text, plan_period text, plan_renews_on timestamptz, stripe_customer_id text,
  grant_plan text, grant_until timestamptz, grant_note text, beta boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_team() then
    raise exception 'owners and the team only';
  end if;
  return query
    select p.id, p.email, p.name, p.handle, p.avatar, p.role, p.plan, p.banned_until, p.created_at, p.updated_at,
           u.last_sign_in_at, u.email_confirmed_at,
           coalesce((select array_agg(i.provider::text order by i.provider) from auth.identities i where i.user_id = p.id), '{}'::text[]),
           p.plan_status, p.plan_period, p.plan_renews_on, p.stripe_customer_id,
           p.grant_plan, p.grant_until, p.grant_note, p.beta
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;
revoke execute on function public.admin_people() from public, anon;
grant execute on function public.admin_people() to authenticated;

-- THE ONE DOOR, WIDENED: the grants and beta ride the same patch; owners alone ------------------------------------
create or replace function public.admin_update(subject uuid, patch jsonb, note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  cur    public.profiles%rowtype;
  owners int;
begin
  if not public.is_owner() then
    raise exception 'owners only';
  end if;
  if coalesce(trim(note), '') = '' then
    raise exception 'a reason is needed';
  end if;
  select * into cur from public.profiles where id = subject;
  if not found then
    raise exception 'no such person';
  end if;
  /* the last owner stays — a demotion to member or to the team alike */
  if (patch ? 'role') and (patch ->> 'role') <> 'owner' and cur.role = 'owner' then
    select count(*) into owners from public.profiles where role = 'owner';
    if owners <= 1 then
      raise exception 'the last owner stays';
    end if;
  end if;
  if (patch ? 'banned_until') and nullif(patch ->> 'banned_until', '') is not null and subject = me then
    raise exception 'you cannot ban yourself';
  end if;
  /* a grant carries an end: given without one, it ends in ten years — a date you can see */
  if (patch ? 'grant_plan') and nullif(patch ->> 'grant_plan', '') is not null
     and nullif(coalesce(patch ->> 'grant_until', cur.grant_until::text), '') is null then
    patch := patch || jsonb_build_object('grant_until', (now() + interval '10 years')::text);
  end if;
  /* the reason rides the transaction; the log's trigger reads it */
  perform set_config('slayer.note', trim(note), true);
  update public.profiles
     set plan         = coalesce(patch ->> 'plan', plan),
         role         = coalesce(patch ->> 'role', role),
         banned_until = case when patch ? 'banned_until' then nullif(patch ->> 'banned_until', '')::timestamptz else banned_until end,
         grant_plan   = case when patch ? 'grant_plan'  then nullif(patch ->> 'grant_plan', '') else grant_plan end,
         grant_until  = case when patch ? 'grant_plan' and nullif(patch ->> 'grant_plan', '') is null then null
                             when patch ? 'grant_until' then nullif(patch ->> 'grant_until', '')::timestamptz
                             else grant_until end,
         grant_note   = case when patch ? 'grant_plan' and nullif(patch ->> 'grant_plan', '') is null then null
                             when patch ? 'grant_note' then nullif(patch ->> 'grant_note', '')
                             else grant_note end,
         beta         = case when patch ? 'beta' then (patch ->> 'beta')::boolean else beta end
   where id = subject;
end;
$$;
revoke execute on function public.admin_update(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_update(uuid, jsonb, text) to authenticated;
