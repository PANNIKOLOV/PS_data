-- =============================================================================
-- Function privilege hardening
--
-- PostgreSQL grants EXECUTE on every new function to PUBLIC. The REVOKE in the
-- grants migration named `anon` and `authenticated` explicitly, which does not
-- remove that PUBLIC grant — so `anon` still inherited EXECUTE and could reach
-- these functions over PostgREST at /rest/v1/rpc/<name>.
--
-- Every one of them returns false or an empty set for an unauthenticated caller
-- (auth.uid() is null), so nothing leaked. But the previous migration claimed a
-- guarantee it did not deliver, so the grant is corrected at the source: revoke
-- from PUBLIC, then re-grant only to the roles that genuinely need it.
--
-- Also sets an explicit search_path on the three functions that lacked one. A
-- function without it resolves unqualified names against the caller's
-- search_path, which is the standard footgun behind privilege-escalation via
-- shadowed objects.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Revoke the implicit PUBLIC grant.
--
-- This covers every function in the schema, including ones added later in this
-- file, because it runs before the targeted grants below.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

-- New functions must not silently regain the PUBLIC grant either.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- -----------------------------------------------------------------------------
-- Pin search_path on the functions that were missing it.
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.assert_granularity(p_granularity text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_granularity not in ('day', 'week', 'month', 'quarter', 'year') then
    raise exception 'Unsupported granularity: %', p_granularity
      using errcode = '22023';
  end if;
  return p_granularity;
end;
$$;

create or replace function public.safe_timezone(p_timezone text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select name from pg_timezone_names where name = p_timezone limit 1),
    'UTC'
  );
$$;

-- -----------------------------------------------------------------------------
-- Re-grant EXECUTE to signed-in users, for those functions only.
--
-- The trigger functions (touch_updated_at, handle_new_user,
-- guard_profile_self_update) are deliberately absent: a trigger is invoked by
-- the trigger mechanism, not through the caller's EXECUTE privilege, so they
-- keep working while being unreachable as RPCs.
-- -----------------------------------------------------------------------------
grant execute on function public.is_admin()                  to authenticated;
grant execute on function public.has_shop_access(uuid)       to authenticated;
grant execute on function public.can_view_metric(uuid, text) to authenticated;
grant execute on function public.accessible_shop_ids()       to authenticated;

grant execute on function public.assert_granularity(text) to authenticated;
grant execute on function public.safe_timezone(text)      to authenticated;

grant execute on function public.analytics_summary(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_timeseries(uuid[], timestamptz, timestamptz, text, text, boolean) to authenticated;
grant execute on function public.analytics_status_breakdown(uuid[], timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_payment_breakdown(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_customer_mix(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_shop_totals(uuid[], timestamptz, timestamptz, boolean) to authenticated;
