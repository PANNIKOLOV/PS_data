-- =============================================================================
-- Why a scheduler call did not run
--
-- The tick log only recorded calls that got past authentication, which made
-- three very different situations look identical from the admin panel: a cron
-- job that is not running, one whose bearer token does not match, and one
-- hitting a server where SYNC_CRON_SECRET was never set. All three showed
-- "the scheduler has never run", and they need opposite fixes.
--
-- Refused calls are now recorded too, so the panel can say which it is. The
-- endpoint rate-limits those rows — one every few minutes at most — so an
-- anonymous caller still cannot fill the table by hammering it.
-- =============================================================================

alter table public.scheduler_runs
  add column outcome text not null default 'ran';

comment on column public.scheduler_runs.outcome is
  'ran — the call was accepted and shops were checked. unauthorised — the bearer token did not match. not_configured — SYNC_CRON_SECRET is unset on the server.';

alter table public.scheduler_runs
  add constraint scheduler_runs_outcome_valid
    check (outcome in ('ran', 'unauthorised', 'not_configured'));

-- The endpoint reads the most recent refusal before recording another, to
-- decide whether enough time has passed to log this one.
create index scheduler_runs_refused_idx
  on public.scheduler_runs (ran_at desc)
  where outcome <> 'ran';
