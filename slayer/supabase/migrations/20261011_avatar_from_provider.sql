-- ==================================================
--   SLAYER TERMINAL - THE PICTURE A SIGN-IN BRINGS
--   (supabase/migrations/20261011_avatar_from_provider.sql)
--
--   Google sends the account's picture as `avatar_url`
--   (older identities: `picture`) in the user's metadata
--   and in the identity's data; until now the row took
--   the name and left the picture behind (the Account
--   page showed initials). Two doors, both only where
--   there is no picture yet:
--
--   A NEW ROW      handle_new_user() takes the picture
--                  along with the name.
--   A NEW IDENTITY a Google sign-in linked to an account
--                  that already exists fills a row whose
--                  picture is empty — never one that holds
--                  a picture the person chose.
--
--   The row's avatar is read by <img src>: a URL and a
--   data URL (the Account page's drop) both render. A
--   picture dropped later replaces the provider's, as
--   before. Nothing is changed on rows that exist today.
--
--   Run after 20261011_billing.sql.
-- ==================================================

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
  picture   text := nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'), '');
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

  insert into public.profiles (id, email, name, handle, avatar)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'name', ''), candidate, picture)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.handle_new_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  picture text := nullif(coalesce(new.identity_data ->> 'avatar_url', new.identity_data ->> 'picture'), '');
begin
  if new.provider = 'google' and picture is not null then
    update public.profiles set avatar = picture where id = new.user_id and avatar is null;
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_identity() from public, anon, authenticated;

drop trigger if exists on_auth_identity_created on auth.identities;
create trigger on_auth_identity_created
  after insert on auth.identities
  for each row execute function public.handle_new_identity();
