-- ==================================================
--   SLAYER TERMINAL - THE TAPE PLAN
--   (supabase/migrations/20261005_plan_tape.sql)
--
--   Three plans again (Noah, 2026-10-05): Book · Tape ·
--   Desk, the Seat kept off the page. A profile's plan
--   may now be 'tape'. Run after 20261003_profiles.sql.
-- ==================================================

alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check check (plan in ('none', 'book', 'tape', 'desk', 'seat'));
