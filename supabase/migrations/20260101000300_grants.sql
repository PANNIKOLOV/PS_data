-- =============================================================================
-- Explicit privilege grants
--
-- Supabase grants broad default privileges on new public tables to the `anon`
-- and `authenticated` roles, which leaves Row Level Security as the only thing
-- standing between an anonymous request and the data. We do not rely on that:
-- privileges are revoked and then re-granted narrowly, so table permissions and
-- RLS act as two independent layers.
--
--   anon          — no access to anything. The product has no public surface.
--   authenticated — SELECT on reportable data, write access only where an RLS
--                   policy also allows it (admin-managed tables).
--   service_role  — used by server-side sync code, bypasses RLS.
-- =============================================================================

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Anonymous visitors get nothing at all.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- --- read-only reporting data ------------------------------------------------
grant select on public.ps_orders       to authenticated;
grant select on public.ps_customers    to authenticated;
grant select on public.ps_order_states to authenticated;
grant select on public.ps_currencies   to authenticated;
grant select on public.metric_keys     to authenticated;

-- --- profile: users read their own, admins manage all (gated by RLS) ---------
grant select, update on public.profiles to authenticated;

-- --- admin-managed configuration (every write still passes an RLS check) -----
grant select, insert, update, delete on public.shops            to authenticated;
grant select, insert, update, delete on public.shop_assignments to authenticated;

-- --- sync history: readable, and clearable by admins -------------------------
grant select, delete on public.sync_runs to authenticated;

-- --- credentials: server-side only, never reachable with a user JWT ----------
revoke all on public.shop_credentials from anon, authenticated;

-- --- analytics RPCs ----------------------------------------------------------
grant execute on function public.analytics_summary(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_timeseries(uuid[], timestamptz, timestamptz, text, text, boolean) to authenticated;
grant execute on function public.analytics_status_breakdown(uuid[], timestamptz, timestamptz) to authenticated;
grant execute on function public.analytics_payment_breakdown(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_customer_mix(uuid[], timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.analytics_shop_totals(uuid[], timestamptz, timestamptz, boolean) to authenticated;

grant execute on function public.is_admin()                      to authenticated;
grant execute on function public.has_shop_access(uuid)           to authenticated;
grant execute on function public.can_view_metric(uuid, text)     to authenticated;
grant execute on function public.accessible_shop_ids()           to authenticated;
