-- =============================================================================
-- Analytics RPCs
--
-- All functions run as SECURITY INVOKER (the default), so Row Level Security on
-- ps_orders / ps_customers applies to every caller. A marketer therefore cannot
-- widen their result set by passing shop ids they were not assigned — the rows
-- simply are not visible to them.
--
-- Monetary figures use total_paid_base, i.e. the order total converted into the
-- shop's own default currency using the order's conversion_rate. Summing across
-- shops with different default currencies is only meaningful when they match,
-- so every summary reports how many distinct currencies it covered.
-- =============================================================================

-- Rejects anything that is not a supported bucket size.
create or replace function public.assert_granularity(p_granularity text)
returns text
language plpgsql
immutable
as $$
begin
  if p_granularity not in ('day', 'week', 'month', 'quarter', 'year') then
    raise exception 'Unsupported granularity: %', p_granularity
      using errcode = '22023';
  end if;
  return p_granularity;
end;
$$;

-- Falls back to UTC rather than failing when a shop has a bad timezone stored.
create or replace function public.safe_timezone(p_timezone text)
returns text
language sql
stable
as $$
  select coalesce(
    (select name from pg_timezone_names where name = p_timezone limit 1),
    'UTC'
  );
$$;

-- -----------------------------------------------------------------------------
-- Headline figures for a period.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_summary(
  p_shop_ids   uuid[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_only_valid boolean default false
)
returns table (
  orders_count        bigint,
  revenue             numeric,
  average_order_value numeric,
  items_total         numeric,
  shipping_total      numeric,
  discounts_total     numeric,
  unique_customers    bigint,
  new_registrations   bigint,
  currency_count      bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  with scoped_orders as (
    select o.*
    from public.ps_orders o
    where o.shop_id = any (p_shop_ids)
      and o.date_add >= p_from
      and o.date_add < p_to
      and (not p_only_valid or o.is_valid)
  )
  select
    (select count(*) from scoped_orders),
    (select coalesce(sum(total_paid_base), 0) from scoped_orders),
    (select case
              when count(*) = 0 then 0
              else round(coalesce(sum(total_paid_base), 0) / count(*), 2)
            end
     from scoped_orders),
    (select coalesce(sum(total_products), 0) from scoped_orders),
    (select coalesce(sum(total_shipping), 0) from scoped_orders),
    (select coalesce(sum(total_discounts), 0) from scoped_orders),
    (select count(distinct ps_customer_id) from scoped_orders where ps_customer_id is not null),
    (select count(*)
       from public.ps_customers c
      where c.shop_id = any (p_shop_ids)
        and c.date_add >= p_from
        and c.date_add < p_to),
    (select count(distinct s.currency_code)
       from public.shops s
      where s.id = any (p_shop_ids));
$$;

-- -----------------------------------------------------------------------------
-- Time series bucketed by day / week / month / quarter / year.
--
-- Buckets with no activity are still returned (zero-filled) so charts do not
-- silently close gaps in the timeline.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_timeseries(
  p_shop_ids    uuid[],
  p_from        timestamptz,
  p_to          timestamptz,
  p_granularity text default 'day',
  p_timezone    text default 'UTC',
  p_only_valid  boolean default false
)
returns table (
  bucket            timestamptz,
  orders_count      bigint,
  revenue           numeric,
  new_registrations bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  with params as (
    select
      public.assert_granularity(p_granularity) as grain,
      public.safe_timezone(p_timezone)         as tz
  ),
  buckets as (
    select generate_series(
      date_trunc((select grain from params), p_from at time zone (select tz from params)),
      date_trunc((select grain from params), p_to   at time zone (select tz from params)),
      case (select grain from params)
        when 'day'     then interval '1 day'
        when 'week'    then interval '1 week'
        when 'month'   then interval '1 month'
        when 'quarter' then interval '3 months'
        else                interval '1 year'
      end
    ) as local_bucket
  ),
  order_rows as (
    select
      date_trunc(
        (select grain from params),
        o.date_add at time zone (select tz from params)
      ) as local_bucket,
      o.total_paid_base
    from public.ps_orders o
    where o.shop_id = any (p_shop_ids)
      and o.date_add >= p_from
      and o.date_add < p_to
      and (not p_only_valid or o.is_valid)
  ),
  customer_rows as (
    select
      date_trunc(
        (select grain from params),
        c.date_add at time zone (select tz from params)
      ) as local_bucket
    from public.ps_customers c
    where c.shop_id = any (p_shop_ids)
      and c.date_add >= p_from
      and c.date_add < p_to
  )
  select
    b.local_bucket at time zone (select tz from params) as bucket,
    coalesce(o.orders_count, 0),
    coalesce(o.revenue, 0),
    coalesce(c.registrations, 0)
  from buckets b
  left join (
    select local_bucket, count(*) as orders_count, sum(total_paid_base) as revenue
    from order_rows
    group by local_bucket
  ) o on o.local_bucket = b.local_bucket
  left join (
    select local_bucket, count(*) as registrations
    from customer_rows
    group by local_bucket
  ) c on c.local_bucket = b.local_bucket
  where b.local_bucket < (p_to at time zone (select tz from params))
  order by bucket;
$$;

-- -----------------------------------------------------------------------------
-- Order status distribution.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_status_breakdown(
  p_shop_ids uuid[],
  p_from     timestamptz,
  p_to       timestamptz
)
returns table (
  state_id     int,
  state_name   text,
  color        text,
  orders_count bigint,
  revenue      numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    o.current_state,
    coalesce(max(st.name), 'Unknown status'),
    max(st.color),
    count(*),
    coalesce(sum(o.total_paid_base), 0)
  from public.ps_orders o
  left join public.ps_order_states st
    on st.shop_id = o.shop_id
   and st.ps_state_id = o.current_state
  where o.shop_id = any (p_shop_ids)
    and o.date_add >= p_from
    and o.date_add < p_to
  group by o.current_state
  order by count(*) desc;
$$;

-- -----------------------------------------------------------------------------
-- Payment method distribution.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_payment_breakdown(
  p_shop_ids   uuid[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_only_valid boolean default false
)
returns table (
  payment_method text,
  orders_count   bigint,
  revenue        numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    coalesce(nullif(btrim(o.payment_method), ''), 'Unspecified'),
    count(*),
    coalesce(sum(o.total_paid_base), 0)
  from public.ps_orders o
  where o.shop_id = any (p_shop_ids)
    and o.date_add >= p_from
    and o.date_add < p_to
    and (not p_only_valid or o.is_valid)
  group by 1
  order by count(*) desc;
$$;

-- -----------------------------------------------------------------------------
-- First-time versus repeat buyers.
--
-- "Returning" means the customer already had an earlier order in the same shop,
-- whether or not that earlier order falls inside the reporting window.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_customer_mix(
  p_shop_ids   uuid[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_only_valid boolean default false
)
returns table (
  segment      text,
  orders_count bigint,
  revenue      numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  with first_orders as (
    select shop_id, ps_customer_id, min(date_add) as first_order_at
    from public.ps_orders
    where shop_id = any (p_shop_ids)
      and ps_customer_id is not null
    group by shop_id, ps_customer_id
  ),
  classified as (
    select
      case
        when o.ps_customer_id is null then 'Guest / unlinked'
        when o.date_add <= f.first_order_at then 'First-time'
        else 'Returning'
      end as segment,
      o.total_paid_base
    from public.ps_orders o
    left join first_orders f
      on f.shop_id = o.shop_id
     and f.ps_customer_id = o.ps_customer_id
    where o.shop_id = any (p_shop_ids)
      and o.date_add >= p_from
      and o.date_add < p_to
      and (not p_only_valid or o.is_valid)
  )
  select segment, count(*), coalesce(sum(total_paid_base), 0)
  from classified
  group by segment
  order by count(*) desc;
$$;

-- -----------------------------------------------------------------------------
-- Per-shop totals, used by the multi-shop overview.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_shop_totals(
  p_shop_ids   uuid[],
  p_from       timestamptz,
  p_to         timestamptz,
  p_only_valid boolean default false
)
returns table (
  shop_id           uuid,
  shop_name         text,
  currency_code     text,
  orders_count      bigint,
  revenue           numeric,
  new_registrations bigint
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    s.id,
    s.name,
    s.currency_code,
    coalesce(o.orders_count, 0),
    coalesce(o.revenue, 0),
    coalesce(c.registrations, 0)
  from public.shops s
  left join (
    select shop_id, count(*) as orders_count, sum(total_paid_base) as revenue
    from public.ps_orders
    where shop_id = any (p_shop_ids)
      and date_add >= p_from
      and date_add < p_to
      and (not p_only_valid or is_valid)
    group by shop_id
  ) o on o.shop_id = s.id
  left join (
    select shop_id, count(*) as registrations
    from public.ps_customers
    where shop_id = any (p_shop_ids)
      and date_add >= p_from
      and date_add < p_to
    group by shop_id
  ) c on c.shop_id = s.id
  where s.id = any (p_shop_ids)
  order by coalesce(o.revenue, 0) desc;
$$;

grant execute on function public.analytics_summary(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_timeseries(uuid[], timestamptz, timestamptz, text, text, boolean) to authenticated;
grant execute on function public.analytics_status_breakdown(uuid[], timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_payment_breakdown(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_customer_mix(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_shop_totals(uuid[], timestamptz, timestamptz, boolean) to authenticated;
