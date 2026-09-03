-- =============================================================================
-- Regression tests for access control and analytics aggregation.
--
-- Run against a scratch database that has the migrations applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_analytics_test.sql
--
-- Every check raises an exception on failure, so a clean run means a pass.
-- See supabase/tests/README.md for a one-command local harness.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function pg_temp.check_eq(p_label text, p_actual anyelement, p_expected anyelement)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL % — expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'pass  %', p_label;
end;
$$;

-- -----------------------------------------------------------------------------
-- Seed
-- -----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'marketer@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'outsider@example.com');

do $$
begin
  perform pg_temp.check_eq('first signup becomes admin',
    (select role::text from public.profiles where email = 'admin@example.com'), 'admin');
  perform pg_temp.check_eq('second signup becomes marketer',
    (select role::text from public.profiles where email = 'marketer@example.com'), 'marketer');
end $$;

insert into public.shops (id, name, base_url, currency_code, timezone) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Shop A', 'https://a.example.com', 'EUR', 'Europe/Athens'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Shop B', 'https://b.example.com', 'EUR', 'UTC');

-- The marketer gets Shop A only, and is not allowed to see payment methods.
insert into public.shop_assignments (shop_id, user_id, metrics) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   array['revenue','orders','customers','aov','trends']::text[]);

insert into public.ps_order_states (shop_id, ps_state_id, name, is_paid) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 2, 'Payment accepted', true),
  ('bbbbbbbb-0000-0000-0000-000000000002', 2, 'Payment accepted', true);

insert into public.ps_orders (shop_id, ps_order_id, ps_customer_id, current_state, payment_method,
                              is_valid, currency_code, conversion_rate, total_paid, total_paid_base, date_add)
values
  -- Shop A: customer 500 orders twice (second is "returning"), customer 501 once.
  ('aaaaaaaa-0000-0000-0000-000000000001', 1, 500, 2, 'Bank wire', true, 'EUR', 1, 100, 100, '2026-03-10T09:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 2, 500, 2, 'Bank wire', true, 'EUR', 1, 250, 250, '2026-03-11T09:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 3, 501, 2, 'PayPal',    true, 'EUR', 1,  50,  50, '2026-05-02T09:00:00Z'),
  -- 22:30 UTC on 10 March is 00:30 on 11 March in Athens — exercises timezone bucketing.
  ('aaaaaaaa-0000-0000-0000-000000000001', 4, 502, 2, 'PayPal',    true, 'EUR', 1,  10,  10, '2026-03-10T22:30:00Z'),
  -- An invalid (unpaid) order, excluded when p_only_valid is true.
  ('aaaaaaaa-0000-0000-0000-000000000001', 5, 503, 1, 'Bank wire', false,'EUR', 1, 777, 777, '2026-03-12T09:00:00Z'),
  -- Shop B belongs to nobody the marketer can reach.
  ('bbbbbbbb-0000-0000-0000-000000000002', 1, 900, 2, 'PayPal',    true, 'EUR', 1, 999, 999, '2026-03-10T09:00:00Z');

insert into public.ps_customers (shop_id, ps_customer_id, date_add) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 500, '2026-03-01T09:00:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 501, '2026-05-01T09:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 900, '2026-03-01T09:00:00Z');

insert into public.shop_credentials (shop_id, api_key_cipher, key_fingerprint)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'ciphertext', 'fp');

-- =============================================================================
-- Marketer
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare
  v_both uuid[] := array['aaaaaaaa-0000-0000-0000-000000000001',
                         'bbbbbbbb-0000-0000-0000-000000000002']::uuid[];
  v_denied boolean;
begin
  perform pg_temp.check_eq('marketer sees only assigned shops',
    (select count(*) from public.shops), 1::bigint);

  perform pg_temp.check_eq('marketer sees only assigned shop orders',
    (select count(*) from public.ps_orders), 5::bigint);

  perform pg_temp.check_eq('marketer cannot reach another shop by id',
    (select count(*) from public.ps_orders
      where shop_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0::bigint);

  perform pg_temp.check_eq('granted metric is visible',
    public.can_view_metric('aaaaaaaa-0000-0000-0000-000000000001', 'revenue'), true);

  perform pg_temp.check_eq('withheld metric is hidden',
    public.can_view_metric('aaaaaaaa-0000-0000-0000-000000000001', 'payment_methods'), false);

  -- The important one: passing an unassigned shop id into an RPC must not widen
  -- the result. Shop B's 999 must not appear in the total.
  perform pg_temp.check_eq('RPC ignores shop ids the caller cannot see',
    (select revenue from public.analytics_summary(v_both, '2026-01-01Z', '2027-01-01Z')),
    1187::numeric);

  perform pg_temp.check_eq('RPC order count is scoped too',
    (select orders_count from public.analytics_summary(v_both, '2026-01-01Z', '2027-01-01Z')),
    5::bigint);

  -- Credentials must be unreachable with a user JWT.
  begin
    perform 1 from public.shop_credentials;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check_eq('marketer is denied shop credentials', v_denied, true);

  -- A marketer must not be able to promote themselves.
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check_eq('marketer cannot self-promote to admin', v_denied, true);

  perform pg_temp.check_eq('role unchanged after escalation attempt',
    (select role::text from public.profiles where id = auth.uid()), 'marketer');
end $$;

reset role;
reset request.jwt.claim.sub;

-- =============================================================================
-- Admin
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_both uuid[] := array['aaaaaaaa-0000-0000-0000-000000000001',
                         'bbbbbbbb-0000-0000-0000-000000000002']::uuid[];
  v_row record;
begin
  perform pg_temp.check_eq('admin sees every shop',
    (select count(*) from public.shops), 2::bigint);

  perform pg_temp.check_eq('admin sees every order',
    (select count(*) from public.ps_orders), 6::bigint);

  perform pg_temp.check_eq('admin revenue spans all shops',
    (select revenue from public.analytics_summary(v_both, '2026-01-01Z', '2027-01-01Z')),
    2186::numeric);

  perform pg_temp.check_eq('admin sees every metric',
    public.can_view_metric('bbbbbbbb-0000-0000-0000-000000000002', 'payment_methods'), true);

  -- Valid-only filtering drops the unpaid 777 order.
  perform pg_temp.check_eq('valid-only filter excludes unpaid orders',
    (select revenue from public.analytics_summary(v_both, '2026-01-01Z', '2027-01-01Z', true)),
    1409::numeric);

  perform pg_temp.check_eq('registrations counted from ps_customers',
    (select new_registrations from public.analytics_summary(v_both, '2026-01-01Z', '2027-01-01Z')),
    3::bigint);

  -- --- granularity -----------------------------------------------------------
  perform pg_temp.check_eq('yearly bucketing returns one bucket',
    (select count(*) from public.analytics_timeseries(v_both, '2026-01-01Z','2027-01-01Z','year','UTC')),
    1::bigint);

  perform pg_temp.check_eq('quarterly bucketing returns four buckets',
    (select count(*) from public.analytics_timeseries(v_both, '2026-01-01Z','2027-01-01Z','quarter','UTC')),
    4::bigint);

  perform pg_temp.check_eq('monthly bucketing returns twelve buckets',
    (select count(*) from public.analytics_timeseries(v_both, '2026-01-01Z','2027-01-01Z','month','UTC')),
    12::bigint);

  perform pg_temp.check_eq('daily bucketing zero-fills empty days',
    (select count(*) from public.analytics_timeseries(v_both, '2026-03-01Z','2026-04-01Z','day','UTC')),
    31::bigint);

  perform pg_temp.check_eq('Q1 revenue is bucketed correctly',
    (select revenue from public.analytics_timeseries(v_both,'2026-01-01Z','2027-01-01Z','quarter','UTC')
      order by bucket limit 1),
    2136::numeric);

  -- --- timezone --------------------------------------------------------------
  -- The 22:30 UTC order on 10 March lands on 11 March in Athens.
  select orders_count into v_row
    from public.analytics_timeseries(
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      '2026-03-01Z','2026-04-01Z','day','UTC')
    where bucket = '2026-03-10T00:00:00Z';
  perform pg_temp.check_eq('UTC bucketing puts the late order on the 10th', v_row.orders_count, 2::bigint);

  select orders_count into v_row
    from public.analytics_timeseries(
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      '2026-03-01Z','2026-04-01Z','day','Europe/Athens')
    where bucket = '2026-03-09T22:00:00Z'; -- local 10 March 00:00 (EET, UTC+2)
  perform pg_temp.check_eq('Athens bucketing moves it to the 11th', v_row.orders_count, 1::bigint);

  -- An unknown timezone falls back to UTC instead of erroring.
  perform pg_temp.check_eq('invalid timezone falls back to UTC',
    (select count(*) from public.analytics_timeseries(v_both,'2026-03-01Z','2026-04-01Z','day','Not/AZone')),
    31::bigint);

  -- --- breakdowns ------------------------------------------------------------
  perform pg_temp.check_eq('status breakdown resolves state names',
    (select state_name from public.analytics_status_breakdown(v_both,'2026-01-01Z','2027-01-01Z')
      order by orders_count desc limit 1),
    'Payment accepted');

  perform pg_temp.check_eq('payment breakdown groups by module',
    (select orders_count from public.analytics_payment_breakdown(v_both,'2026-01-01Z','2027-01-01Z')
      where payment_method = 'PayPal'),
    3::bigint);

  perform pg_temp.check_eq('repeat purchase is classified as returning',
    (select orders_count from public.analytics_customer_mix(v_both,'2026-01-01Z','2027-01-01Z')
      where segment = 'Returning'),
    1::bigint);

  perform pg_temp.check_eq('first purchases are classified as first-time',
    (select orders_count from public.analytics_customer_mix(v_both,'2026-01-01Z','2027-01-01Z')
      where segment = 'First-time'),
    5::bigint);

  -- --- per-shop totals -------------------------------------------------------
  perform pg_temp.check_eq('shop totals rank by revenue',
    (select shop_name from public.analytics_shop_totals(v_both,'2026-01-01Z','2027-01-01Z') limit 1),
    'Shop A');
end $$;

reset role;
reset request.jwt.claim.sub;

-- =============================================================================
-- A user with no assignments at all sees nothing.
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $$
begin
  perform pg_temp.check_eq('unassigned user sees no shops',
    (select count(*) from public.shops), 0::bigint);
  perform pg_temp.check_eq('unassigned user sees no orders',
    (select count(*) from public.ps_orders), 0::bigint);
  perform pg_temp.check_eq('unassigned user gets empty analytics',
    (select orders_count from public.analytics_summary(
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[], '2026-01-01Z','2027-01-01Z')),
    0::bigint);
end $$;

reset role;
reset request.jwt.claim.sub;

-- =============================================================================
-- Anonymous callers are refused at the privilege layer, before RLS is consulted.
-- =============================================================================
set role anon;
do $$
declare v_denied boolean;
begin
  begin
    perform 1 from public.ps_orders;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check_eq('anonymous role is denied order data', v_denied, true);
end $$;
reset role;

-- =============================================================================
-- Sync scheduling and the marketer daily cap
--
-- The cap is the only thing limiting how hard a marketer can make the platform
-- hit a shop's server, and the sync engine itself runs with the service role
-- and bypasses RLS. So it is asserted here rather than trusted to the interface.
-- =============================================================================

-- Shop C allows no manual syncing; shop D is paused. Both are assigned to the
-- marketer, so the refusals below are about the setting, not about access.
insert into public.shops (id, name, base_url, currency_code, timezone,
                          manual_sync_daily_limit, is_active) values
  ('cccccccc-0000-0000-0000-000000000003', 'Shop C', 'https://c.example.com', 'EUR', 'UTC', 0, true),
  ('dddddddd-0000-0000-0000-000000000004', 'Shop D', 'https://d.example.com', 'EUR', 'UTC', 5, false);

insert into public.shop_assignments (shop_id, user_id) values
  ('cccccccc-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222'),
  ('dddddddd-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222');

-- --- day boundaries ----------------------------------------------------------
do $$
begin
  -- 10:00 UTC on 31 August is 13:00 in Athens, so the Athens day began at
  -- 21:00 UTC on the 30th. Reading the window in UTC would reset a Greek
  -- shop's allowance in the middle of its afternoon.
  perform pg_temp.check_eq('a shop day starts at local midnight',
    public.shop_day_start('Europe/Athens', '2026-08-31T10:00:00Z'),
    '2026-08-30T21:00:00Z'::timestamptz);

  perform pg_temp.check_eq('a UTC shop day starts at UTC midnight',
    public.shop_day_start('UTC', '2026-08-31T10:00:00Z'),
    '2026-08-31T00:00:00Z'::timestamptz);

  perform pg_temp.check_eq('an unknown timezone falls back to UTC',
    public.shop_day_start('Not/AZone', '2026-08-31T10:00:00Z'),
    '2026-08-31T00:00:00Z'::timestamptz);
end $$;

-- Four runs already used today, leaving one of Shop A's default five.
insert into public.sync_runs (shop_id, status, trigger_source, triggered_by, started_at, finished_at)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'success', 'manual',
       '22222222-2222-2222-2222-222222222222',
       public.shop_day_start('Europe/Athens') + interval '1 hour', now()
from generate_series(1, 4);

-- =============================================================================
-- Marketer: the cap holds
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare
  v_quota record;
  v_run   uuid;
  v_code  text;
begin
  select * into v_quota
    from public.manual_sync_quota('aaaaaaaa-0000-0000-0000-000000000001');

  perform pg_temp.check_eq('quota counts the runs already used today', v_quota.used, 4);
  perform pg_temp.check_eq('quota reports the shop allowance', v_quota.allowed, 5);
  perform pg_temp.check_eq('a marketer is capped', v_quota.is_limited, true);

  -- The fifth is allowed and records a run to report against.
  v_run := public.claim_manual_sync('aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.check_eq('the last allowed sync is claimed', v_run is not null, true);

  perform pg_temp.check_eq('the claim records exactly one run',
    (select count(*) from public.sync_runs
      where id = v_run and status = 'running' and trigger_source = 'manual'
        and triggered_by = '22222222-2222-2222-2222-222222222222'),
    1::bigint);

  -- A second click while the first is still running is refused, so two syncs
  -- never hammer one shop at once.
  begin
    perform public.claim_manual_sync('aaaaaaaa-0000-0000-0000-000000000001');
    v_code := 'no error';
  exception when others then
    v_code := sqlstate;
  end;
  perform pg_temp.check_eq('a concurrent sync is refused', v_code, 'PS002');
end $$;

-- A marketer must not be able to clear their own history to win back syncs.
do $$
declare v_before bigint;
begin
  select count(*) into v_before from public.sync_runs
    where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  delete from public.sync_runs where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  perform pg_temp.check_eq('a marketer cannot delete runs to reset the cap',
    (select count(*) from public.sync_runs
      where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    v_before);
end $$;

-- Nor insert a run themselves, which would let them forge the audit trail.
do $$
declare v_denied boolean;
begin
  begin
    insert into public.sync_runs (shop_id, trigger_source)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'manual');
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check_eq('a marketer cannot write sync history directly', v_denied, true);
end $$;

reset role;
reset request.jwt.claim.sub;

-- The in-flight run finishes, so the next claim meets the cap rather than the
-- concurrency guard.
update public.sync_runs set status = 'success', finished_at = now() where status = 'running';

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare
  v_code  text;
  v_quota record;
begin
  begin
    perform public.claim_manual_sync('aaaaaaaa-0000-0000-0000-000000000001');
    v_code := 'no error';
  exception when others then
    v_code := sqlstate;
  end;
  perform pg_temp.check_eq('the sixth sync of the day is refused', v_code, 'PS001');

  select * into v_quota
    from public.manual_sync_quota('aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.check_eq('quota reports the allowance as spent', v_quota.used, 5);

  -- A shop whose allowance is zero, and a paused shop, are both refused.
  begin
    perform public.claim_manual_sync('cccccccc-0000-0000-0000-000000000003');
    v_code := 'no error';
  exception when others then
    v_code := sqlstate;
  end;
  perform pg_temp.check_eq('a shop with no allowance refuses manual syncs', v_code, 'PS003');

  begin
    perform public.claim_manual_sync('dddddddd-0000-0000-0000-000000000004');
    v_code := 'no error';
  exception when others then
    v_code := sqlstate;
  end;
  perform pg_temp.check_eq('a paused shop refuses manual syncs', v_code, 'PS003');

  -- An unassigned shop is refused, and reports nothing about itself.
  begin
    perform public.claim_manual_sync('bbbbbbbb-0000-0000-0000-000000000002');
    v_code := 'no error';
  exception when others then
    v_code := sqlstate;
  end;
  perform pg_temp.check_eq('an unassigned shop cannot be synced', v_code, '42501');

  perform pg_temp.check_eq('quota says nothing about an unassigned shop',
    (select count(*) from public.manual_sync_quota('bbbbbbbb-0000-0000-0000-000000000002')),
    0::bigint);
end $$;

reset role;
reset request.jwt.claim.sub;

-- =============================================================================
-- Yesterday's runs do not count, and the boundary is the shop's own midnight
-- =============================================================================
delete from public.sync_runs where shop_id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.sync_runs (shop_id, status, trigger_source, triggered_by, started_at, finished_at)
values
  -- One minute before midnight in Athens: yesterday for this shop, even though
  -- it is still the same UTC date.
  ('aaaaaaaa-0000-0000-0000-000000000001', 'success', 'manual',
   '22222222-2222-2222-2222-222222222222',
   public.shop_day_start('Europe/Athens') - interval '1 minute', now()),
  -- One minute after: today.
  ('aaaaaaaa-0000-0000-0000-000000000001', 'success', 'manual',
   '22222222-2222-2222-2222-222222222222',
   public.shop_day_start('Europe/Athens') + interval '1 minute', now()),
  -- Scheduled runs are the platform's own, not the marketer's.
  ('aaaaaaaa-0000-0000-0000-000000000001', 'success', 'scheduled', null,
   public.shop_day_start('Europe/Athens') + interval '2 minutes', now());

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare v_quota record;
begin
  select * into v_quota
    from public.manual_sync_quota('aaaaaaaa-0000-0000-0000-000000000001');

  perform pg_temp.check_eq('the allowance covers only the shop''s own day', v_quota.used, 1);
  perform pg_temp.check_eq('the allowance resets at the next local midnight',
    v_quota.resets_at,
    public.shop_day_start('Europe/Athens') + interval '1 day');
end $$;

reset role;
reset request.jwt.claim.sub;

-- =============================================================================
-- Admins are not capped
-- =============================================================================
insert into public.sync_runs (shop_id, status, trigger_source, triggered_by, started_at, finished_at)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'success', 'manual',
       '11111111-1111-1111-1111-111111111111',
       public.shop_day_start('Europe/Athens') + interval '1 hour', now()
from generate_series(1, 8);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_quota record;
  v_run   uuid;
begin
  select * into v_quota
    from public.manual_sync_quota('aaaaaaaa-0000-0000-0000-000000000001');

  perform pg_temp.check_eq('an admin is not capped', v_quota.is_limited, false);
  perform pg_temp.check_eq('an admin still sees their own usage', v_quota.used, 8);

  -- Well past the shop's allowance of five, and still allowed.
  v_run := public.claim_manual_sync('aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.check_eq('an admin syncs past the shop allowance', v_run is not null, true);
end $$;

reset role;
reset request.jwt.claim.sub;

update public.sync_runs set status = 'success', finished_at = now() where status = 'running';

-- =============================================================================
-- A user with no assignment cannot claim a sync at all
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $$
declare v_code text;
begin
  begin
    perform public.claim_manual_sync('aaaaaaaa-0000-0000-0000-000000000001');
    v_code := 'no error';
  exception when others then
    v_code := sqlstate;
  end;
  perform pg_temp.check_eq('an unassigned user cannot claim a sync', v_code, '42501');
end $$;

reset role;
reset request.jwt.claim.sub;

-- =============================================================================
-- Scheduling settings are the admin's to change, not the marketer's
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
begin
  update public.shops
     set manual_sync_daily_limit = 50, sync_interval_minutes = 60
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  perform pg_temp.check_eq('a marketer cannot raise their own allowance',
    (select manual_sync_daily_limit from public.shops
      where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    5);
end $$;

reset role;
reset request.jwt.claim.sub;

do $$
declare v_rejected boolean;
begin
  -- The check constraints keep a stray value out of the scheduler's arithmetic.
  begin
    update public.shops set sync_interval_minutes = 20161
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  perform pg_temp.check_eq('an out-of-range interval is rejected', v_rejected, true);

  begin
    update public.shops set manual_sync_daily_limit = -1
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  perform pg_temp.check_eq('a negative daily cap is rejected', v_rejected, true);
end $$;

-- =============================================================================
-- The scheduler tick log is operational detail, for admins only
-- =============================================================================
insert into public.scheduler_runs (shops_considered, shops_due, shops_synced, shops_failed)
values (4, 2, 2, 0), (4, 0, 0, 0);

-- A refused call is recorded too, so "nothing is calling" and "everything that
-- calls is turned away" can be told apart.
insert into public.scheduler_runs (outcome, error_message)
values ('unauthorised', 'A call arrived with a missing or incorrect bearer token.');

do $$
declare v_rejected boolean;
begin
  perform pg_temp.check_eq('an accepted call defaults to the ran outcome',
    (select count(*) from public.scheduler_runs where outcome = 'ran'), 2::bigint);

  begin
    insert into public.scheduler_runs (outcome) values ('something-else');
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  perform pg_temp.check_eq('an unknown outcome is rejected', v_rejected, true);
end $$;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare v_blocked boolean;
begin
  perform pg_temp.check_eq('a marketer sees no scheduler ticks',
    (select count(*) from public.scheduler_runs), 0::bigint);

  -- And cannot write one, which would let them fake a healthy scheduler.
  begin
    insert into public.scheduler_runs (shops_considered) values (99);
    v_blocked := false;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform pg_temp.check_eq('a marketer cannot write scheduler ticks', v_blocked, true);
end $$;

reset role;
reset request.jwt.claim.sub;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
begin
  perform pg_temp.check_eq('an admin sees every scheduler tick',
    (select count(*) from public.scheduler_runs), 3::bigint);
  perform pg_temp.check_eq('an admin sees the refused call',
    (select count(*) from public.scheduler_runs where outcome = 'unauthorised'), 1::bigint);
end $$;

reset role;
reset request.jwt.claim.sub;

set role anon;
do $$
declare v_denied boolean;
begin
  begin
    perform 1 from public.scheduler_runs;
    v_denied := false;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform pg_temp.check_eq('anonymous callers are denied scheduler ticks', v_denied, true);
end $$;
reset role;

select 'ALL CHECKS PASSED' as result;
