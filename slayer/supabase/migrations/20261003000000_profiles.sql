-- ============================================================================
--  SLAYER TERMINAL - THE ACCOUNT'S ROW (supabase/migrations/20261003_profiles.sql)
--
--  Run ONCE in the project's SQL editor (Supabase → SQL → New query → paste → Run),
--  before the first sign-up. It makes:
--    public.profiles        one row per account: email, name, handle, picture, ROLE
--                           (owner · member), plan, a ban — what the app and the admin
--                           rooms read (src/data/account.ts)
--    row-level security     a member reads and edits their OWN row and cannot touch
--                           role, plan or the ban; an owner reads and edits every row
--    two triggers           a sign-up gets its row (name from the form, a handle from
--                           the address made unique); an email change follows
--
--  The publishable key in the browser can only do what these policies allow. The
--  owners are named at the bottom, after the two of you have signed up.
-- ============================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  name         text not null default '',
  handle       text unique,
  avatar       text,                                     -- a small data URL (128px jpeg) for now; storage later
  role         text not null default 'member' check (role in ('owner', 'member')),
  plan         text not null default 'none'   check (plan in ('none', 'book', 'desk', 'seat')),
  banned_until timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'One row per account — what the terminal and the admin rooms read about a person.';

-- Is the caller an owner? SECURITY DEFINER so the policies below can ask without reading
-- profiles under their own policies (which would recurse).
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own, owners read all" on public.profiles;
create policy "profiles: read own, owners read all"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_owner());

drop policy if exists "profiles: update own, owners update all" on public.profiles;
create policy "profiles: update own, owners update all"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_owner())
  with check (id = auth.uid() or public.is_owner());

-- No insert or delete policy on purpose: a row is made by the sign-up trigger below and
-- dies with the auth user (on delete cascade). Nothing in the browser can make or remove one.

-- A member may not promote, re-plan or un-ban themselves: those three columns move only
-- under an owner. The same trigger keeps updated_at.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
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

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- Every sign-up gets its row: the email, the name typed on the form, and a handle made from
-- the address — letters, digits and _ only, at least three characters, made unique with digits.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base      text := lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-z0-9_]', '', 'g'));
  candidate text;
  tries     int := 0;
begin
  if length(base) < 3 then
    base := 'trader';
  end if;
  base := left(base, 16);
  candidate := base;
  while exists (select 1 from public.profiles where handle = candidate) loop
    tries := tries + 1;
    candidate := base || (floor(random() * 9000) + 1000)::int::text;
    if tries > 20 then
      candidate := left(base, 8) || replace(gen_random_uuid()::text, '-', '');
    end if;
  end loop;

  insert into public.profiles (id, email, name, handle)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'name', ''), candidate)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The row's email follows the account's (a change confirmed through the service's own mail).
create or replace function public.handle_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email on auth.users;
create trigger on_auth_user_email
  after update of email on auth.users
  for each row execute function public.handle_user_email();

-- ----------------------------------------------------------------------------
--  THE OWNERS. After the two of you have signed up, run this once with your addresses
--  (it is the only way a role moves — the browser's key cannot do it):
--
--    update public.profiles set role = 'owner' where email in ('you@example.com', 'partner@example.com');
-- ----------------------------------------------------------------------------
