-- Caps on the synced browser state (data/sync.ts carries about 50 keys): at most 100 keys and 8 MB per user.
-- An upsert of a key the user already has is never refused by the key count.

create or replace function public.user_state_caps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  keys  int;
  bytes bigint;
begin
  if tg_op = 'INSERT' and not exists (select 1 from public.user_state where user_id = new.user_id and key = new.key) then
    select count(*) into keys from public.user_state where user_id = new.user_id;
    if keys >= 100 then
      raise exception 'user_state holds at most 100 keys per user';
    end if;
  end if;
  select coalesce(sum(length(value)), 0) into bytes from public.user_state where user_id = new.user_id and key <> new.key;
  if bytes + coalesce(length(new.value), 0) > 8388608 then
    raise exception 'user_state holds at most 8 MB per user';
  end if;
  return new;
end;
$$;
revoke execute on function public.user_state_caps() from public, anon, authenticated;

drop trigger if exists user_state_caps on public.user_state;
create trigger user_state_caps
  before insert or update on public.user_state
  for each row execute function public.user_state_caps();
