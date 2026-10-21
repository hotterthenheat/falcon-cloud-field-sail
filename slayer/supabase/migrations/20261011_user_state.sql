-- THE STORES' SYNC (2026-10-10, applied through the connector as "user_state"): what a person keeps in the browser — the
-- watchlist, the desks, the journal, the preferences — carried by the account so it follows them between machines.
-- One row a key, the value as the browser kept it (a string; null = the key was removed), last write wins by
-- updated_at (data/sync.ts). A person reads and writes only their own rows; the cascade removes them with the account.
create table if not exists public.user_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key ~ '^slayer_[a-z0-9_]{1,80}$'),
  value text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_state enable row level security;
drop policy if exists "user_state own select" on public.user_state;
create policy "user_state own select" on public.user_state for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "user_state own insert" on public.user_state;
create policy "user_state own insert" on public.user_state for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "user_state own update" on public.user_state;
create policy "user_state own update" on public.user_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "user_state own delete" on public.user_state;
create policy "user_state own delete" on public.user_state for delete to authenticated using ((select auth.uid()) = user_id);
-- a value is at most a megabyte: the stores are small JSON, and a runaway one must not fill the table
alter table public.user_state drop constraint if exists user_state_value_size;
alter table public.user_state add constraint user_state_value_size check (value is null or length(value) <= 1048576);
grant select, insert, update, delete on public.user_state to authenticated;
revoke all on public.user_state from anon;
