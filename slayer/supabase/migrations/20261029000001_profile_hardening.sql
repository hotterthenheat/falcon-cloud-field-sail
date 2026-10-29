-- Profile hardening.
--   * A member can no longer change their own email; it follows auth.users through handle_user_email().
--   * A member's avatar is a data:image URL of at most 64 KB, or an https picture from a sign-in provider.
--   * Every avatar is capped at 256 KB, and name and handle at 120 and 64 characters (new writes only: NOT VALID).
--   * admin_people() reports the sign-in email from auth.users, so a forged profile email cannot show there.
-- Triggers run by the auth service (sign-up, identity links, email changes) have no auth.uid() and are not limited.

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
    if new.email is distinct from old.email then
      raise exception 'the email follows the sign-in address; change it through the account service';
    end if;
    if new.avatar is distinct from old.avatar and coalesce(new.avatar, '') <> ''
       and not (
         (length(new.avatar) <= 65536 and new.avatar ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$')
         or (length(new.avatar) <= 2048 and new.avatar ~ '^https://[a-z0-9.-]+\.(googleusercontent|githubusercontent)\.com/[^\s"''<>]*$')
       ) then
      raise exception 'a picture is a data:image URL of at most 64 KB, or a sign-in provider''s picture';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

alter table public.profiles drop constraint if exists profiles_avatar_size;
alter table public.profiles add constraint profiles_avatar_size check (avatar is null or length(avatar) <= 262144) not valid;
alter table public.profiles drop constraint if exists profiles_name_size;
alter table public.profiles add constraint profiles_name_size check (char_length(name) <= 120) not valid;
alter table public.profiles drop constraint if exists profiles_handle_size;
alter table public.profiles add constraint profiles_handle_size check (handle is null or char_length(handle) <= 64) not valid;

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
    select p.id, coalesce(u.email::text, p.email), p.name, p.handle, p.avatar, p.role, p.plan, p.banned_until, p.created_at, p.updated_at,
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
