-- =============================================================================
-- Scheduler tick log
--
-- sync_runs records what the platform synced. It cannot answer the question an
-- admin actually asks when figures look stale — "is the cron job running at
-- all?" — because a tick with nothing due writes no rows, which looks exactly
-- like a tick that never happened.
--
-- So each call to /api/cron/sync records itself here, whether or not it had
-- work to do. A gap in this table means the schedule is not firing; an empty
-- table means it has never fired, which is usually a wrong or missing
-- SYNC_CRON_SECRET.
-- =============================================================================

create table public.scheduler_runs (
  id                uuid primary key default gen_random_uuid(),
  ran_at            timestamptz not null default now(),
  -- Active shops seen, of which those whose interval had elapsed, of which
  -- those that actually synced and those that failed.
  shops_considered  int not null default 0,
  shops_due         int not null default 0,
  shops_synced      int not null default 0,
  shops_failed      int not null default 0,
  duration_ms       int,
  error_message     text
);

comment on table public.scheduler_runs is
  'One row per call to the scheduled sync endpoint, including ticks with nothing due. Lets an admin tell a silent cron from an idle one.';

create index scheduler_runs_ran_at_idx on public.scheduler_runs (ran_at desc);

-- -----------------------------------------------------------------------------
-- Admins only.
--
-- The tick log says nothing about any one shop's figures, but it does reveal
-- how many shops exist and when the platform is busy, which is operational
-- detail a marketer has no use for.
-- -----------------------------------------------------------------------------
alter table public.scheduler_runs enable row level security;

create policy "scheduler runs: admins read"
  on public.scheduler_runs for select
  to authenticated
  using (public.is_admin());

create policy "scheduler runs: admins manage"
  on public.scheduler_runs for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.scheduler_runs from anon, authenticated;
grant select, delete on public.scheduler_runs to authenticated;
