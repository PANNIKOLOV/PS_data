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

select 'ALL CHECKS PASSED' as result;
