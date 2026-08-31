-- =============================================================================
-- Sync scheduling and marketer-initiated refreshes
--
-- Two things are added here:
--
--   1. A per-shop cadence the admin controls. The scheduled runner asks which
--      shops are due rather than syncing every active shop on every tick.
--
--   2. A "sync now" path for marketers, capped per day. The cap has to live in
--      the database: the sync engine runs with the service role and therefore
--      bypasses Row Level Security, so a check made only in application code
--      would be the sole thing standing between a marketer and unlimited
--      requests against the shop's server.
--
-- The cap is enforced by claim_manual_sync(), which both counts and records in
-- one transaction. Counting in one statement and inserting in another would let
-- two simultaneous clicks each see four runs and both proceed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Per-shop scheduling settings
-- -----------------------------------------------------------------------------
alter table public.shops
  add column sync_interval_minutes int not null default 1440,
  add column manual_sync_daily_limit int not null default 5;

comment on column public.shops.sync_interval_minutes is
  'How often the scheduled runner should sync this shop, in minutes. 0 disables scheduled syncing, leaving the shop manual-only.';

comment on column public.shops.manual_sync_daily_limit is
  'How many manual syncs one marketer may run for this shop per day, counted in the shop timezone. 0 turns marketer-initiated syncing off. Admins are never limited.';

-- A week is the longest cadence that still counts as a schedule; beyond that an
-- admin is better off syncing manually. The upper bound on the daily cap keeps
-- a typo from turning into thousands of requests against a shop.
alter table public.shops
  add constraint shops_sync_interval_range
    check (sync_interval_minutes >= 0 and sync_interval_minutes <= 10080),
  add constraint shops_manual_sync_limit_range
    check (manual_sync_daily_limit >= 0 and manual_sync_daily_limit <= 50);

-- The scheduled runner asks for due shops ordered by staleness.
create index shops_schedule_idx
  on public.shops (last_sync_at nulls first)
  where is_active and sync_interval_minutes > 0;

-- Counting a marketer's runs for the day is the hot path of the rate limit.
create index sync_runs_quota_idx
  on public.sync_runs (shop_id, triggered_by, started_at desc)
  where trigger_source = 'manual';

-- -----------------------------------------------------------------------------
-- Day boundaries in the shop's own timezone
--
-- A shop's trading day is the one its staff work to, not the server's. Reading
-- the quota window in UTC would reset it in the middle of an afternoon for a
-- shop in Sydney.
-- -----------------------------------------------------------------------------
create or replace function public.shop_day_start(p_timezone text, p_at timestamptz default now())
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select date_trunc('day', p_at at time zone public.safe_timezone(p_timezone))
           at time zone public.safe_timezone(p_timezone);
$$;

comment on function public.shop_day_start(text, timestamptz) is
  'Midnight of the local day containing p_at, in the given timezone, as an instant.';

-- -----------------------------------------------------------------------------
-- manual_sync_quota — what the interface shows
--
-- SECURITY INVOKER, so Row Level Security decides which shop rows and which
-- sync_runs rows the caller can see. A caller passing a shop id they were not
-- assigned reads nothing and receives no row, which is the same answer they get
-- for a shop that does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.manual_sync_quota(p_shop_id uuid)
returns table (
  used int,
  allowed int,
  is_limited boolean,
  resets_at timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    (
      select count(*)::int
      from public.sync_runs r
      where r.shop_id = s.id
        and r.triggered_by = auth.uid()
        and r.trigger_source = 'manual'
        and r.started_at >= public.shop_day_start(s.timezone)
    ) as used,
    s.manual_sync_daily_limit as allowed,
    not public.is_admin() as is_limited,
    -- Next local midnight. The day is added to the wall clock before the zone
    -- is reapplied, so a clock change makes the window 23 or 25 hours long
    -- rather than shifting the reset an hour off the shop's midnight.
    (
      date_trunc('day', now() at time zone public.safe_timezone(s.timezone)) + interval '1 day'
    ) at time zone public.safe_timezone(s.timezone) as resets_at
  from public.shops s
  where s.id = p_shop_id;
$$;

comment on function public.manual_sync_quota(uuid) is
  'The calling user''s manual-sync usage for one shop today. Returns no row when the shop is not visible to them.';

-- -----------------------------------------------------------------------------
-- claim_manual_sync — the enforcement point
--
-- Returns the id of a freshly recorded sync_runs row, which the caller passes
-- to the sync engine so one run produces exactly one audit record. Raising
-- rather than returning null keeps a failed claim from being mistaken for a
-- successful one.
--
-- SECURITY DEFINER because sync_runs is admin-writable under RLS and a marketer
-- must still be able to record their own run. Every path therefore re-derives
-- the caller's rights from auth.uid(); nothing is taken from the arguments
-- beyond the shop id being asked about.
-- -----------------------------------------------------------------------------
create or replace function public.claim_manual_sync(p_shop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_admin    boolean;
  v_timezone text;
  v_limit    int;
  v_used     int;
  v_run_id   uuid;
begin
  if v_user is null then
    raise exception 'You must be signed in to run a sync.' using errcode = '42501';
  end if;

  if not public.has_shop_access(p_shop_id) then
    -- Deliberately the same answer for "no such shop" and "not yours", so the
    -- existence of other people's shops cannot be probed.
    raise exception 'That shop is not available to you.' using errcode = '42501';
  end if;

  v_admin := public.is_admin();

  select s.timezone, s.manual_sync_daily_limit
    into v_timezone, v_limit
    from public.shops s
   where s.id = p_shop_id
     and s.is_active;

  if not found then
    raise exception 'That shop is paused, so it cannot be synced.' using errcode = 'PS003';
  end if;

  -- Serialise concurrent claims for this shop. Held to the end of the
  -- transaction, so the count below cannot be read by a second caller until
  -- this one has inserted its row.
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text, 0));

  -- A run still marked running after fifteen minutes is treated as abandoned,
  -- so a crashed process cannot lock a shop out of syncing for good.
  if exists (
    select 1
    from public.sync_runs r
    where r.shop_id = p_shop_id
      and r.status = 'running'
      and r.started_at > now() - interval '15 minutes'
  ) then
    raise exception 'A sync for this shop is already running.' using errcode = 'PS002';
  end if;

  if not v_admin then
    if v_limit <= 0 then
      raise exception 'Manual syncing is turned off for this shop.' using errcode = 'PS003';
    end if;

    select count(*)::int
      into v_used
      from public.sync_runs r
     where r.shop_id = p_shop_id
       and r.triggered_by = v_user
       and r.trigger_source = 'manual'
       and r.started_at >= public.shop_day_start(v_timezone);

    -- Every attempt counts, including ones that end in failure: an unreachable
    -- shop is exactly the case where retrying in a loop does the most harm.
    if v_used >= v_limit then
      raise exception 'You have used all % syncs for this shop today.', v_limit
        using errcode = 'PS001';
    end if;
  end if;

  insert into public.sync_runs (shop_id, status, trigger_source, triggered_by)
  values (p_shop_id, 'running', 'manual', v_user)
  returning id into v_run_id;

  return v_run_id;
end;
$$;

comment on function public.claim_manual_sync(uuid) is
  'Reserves a manual sync for the calling user, enforcing the shop daily cap, and returns the sync_runs id to report against.';

-- -----------------------------------------------------------------------------
-- Grants
--
-- The default privileges set in the hardening migration already keep PUBLIC and
-- anon off new functions; the revokes are repeated here so this file states its
-- own guarantee rather than depending on one made elsewhere.
-- -----------------------------------------------------------------------------
revoke execute on function public.shop_day_start(text, timestamptz) from public, anon;
revoke execute on function public.manual_sync_quota(uuid)           from public, anon;
revoke execute on function public.claim_manual_sync(uuid)           from public, anon;

grant execute on function public.shop_day_start(text, timestamptz) to authenticated;
grant execute on function public.manual_sync_quota(uuid)           to authenticated;
grant execute on function public.claim_manual_sync(uuid)           to authenticated;
