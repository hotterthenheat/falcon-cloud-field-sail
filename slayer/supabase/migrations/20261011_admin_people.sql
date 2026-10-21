-- ==================================================
--   SLAYER TERMINAL - THE PEOPLE ROOM'S GROUND
--   (supabase/migrations/20261011_admin_people.sql)
--
--   The admin People room (Noah, 2026-10-10: "start
--   with the admin people room"). Three things:
--
--   THE LOG        public.audit_log — every change to a
--                  person's plan, role or ban, written by
--                  the database itself the moment the row
--                  changes (a trigger), never by a page:
--                  who (null = the dashboard), whom, what,
--                  old → new, and the reason. Owners read
--                  it; nothing in the browser can write it.
--   THE LIST       admin_people() — the profiles joined
--                  with what only the auth side knows
--                  (last sign-in, the email confirmed, the
--                  ways in). Owners only; anyone else is
--                  refused, not shown an empty list.
--   THE ONE DOOR   admin_update(subject, patch, note) —
--                  a change and its reason in one breath,
--                  so the log can never miss the why. It
--                  refuses to demote the last owner and to
--                  ban the caller.
--
--   Run after 20261010_platform_lockdown.sql.
-- ==================================================

-- THE LOG ------------------------------------------------------------------------------------------------------------
create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  /** the owner who made the change; null when the dashboard did (no signed-in user) */
  actor    uuid references public.profiles (id) on delete set null,
  subject  uuid not null references public.profiles (id) on delete cascade,
  field    text not null,
  old      text,
  new      text,
  note     text
);
create index if not exists audit_log_subject_at on public.audit_log (subject, at desc);
create index if not exists audit_log_at on public.audit_log (at desc);
comment on table public.audit_log is 'Every change to a person''s plan, role or ban — who, whom, what, old to new, and why. Written by the database, read by owners.';

alter table public.audit_log enable row level security;
drop policy if exists "audit_log: owners read" on public.audit_log;
create policy "audit_log: owners read"
  on public.audit_log for select
  to authenticated
  using ((select public.is_owner()));
-- no insert, update or delete policy on purpose: the trigger below writes it as definer

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
  if new.role is distinct from old.role then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'role', old.role, new.role, why);
  end if;
  if new.banned_until is distinct from old.banned_until then
    insert into public.audit_log (actor, subject, field, old, new, note) values (who, new.id, 'banned_until', old.banned_until::text, new.banned_until::text, why);
  end if;
  return new;
end;
$$;
revoke execute on function public.audit_profile_changes() from public, anon, authenticated;

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after update on public.profiles
  for each row execute function public.audit_profile_changes();

-- THE LIST -----------------------------------------------------------------------------------------------------------
create or replace function public.admin_people()
returns table (
  id uuid, email text, name text, handle text, avatar text, role text, plan text, banned_until timestamptz,
  created_at timestamptz, updated_at timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz, providers text[]
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
           coalesce((select array_agg(i.provider::text order by i.provider) from auth.identities i where i.user_id = p.id), '{}'::text[])
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;
revoke execute on function public.admin_people() from public, anon;

-- THE ONE DOOR -------------------------------------------------------------------------------------------------------
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
  if (patch ? 'role') and (patch ->> 'role') = 'member' and cur.role = 'owner' then
    select count(*) into owners from public.profiles where role = 'owner';
    if owners <= 1 then
      raise exception 'the last owner stays';
    end if;
  end if;
  if (patch ? 'banned_until') and nullif(patch ->> 'banned_until', '') is not null and subject = me then
    raise exception 'you cannot ban yourself';
  end if;
  /* the reason rides the transaction; the log's trigger reads it */
  perform set_config('slayer.note', trim(note), true);
  update public.profiles
     set plan         = coalesce(patch ->> 'plan', plan),
         role         = coalesce(patch ->> 'role', role),
         banned_until = case when patch ? 'banned_until' then nullif(patch ->> 'banned_until', '')::timestamptz else banned_until end
   where id = subject;
end;
$$;
revoke execute on function public.admin_update(uuid, jsonb, text) from public, anon;
