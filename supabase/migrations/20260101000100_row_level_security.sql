-- =============================================================================
-- Row Level Security
--
-- Two roles:
--   admin    — full read/write across every shop and user.
--   marketer — read-only, and only for shops explicitly assigned to them.
--
-- Credentials (shop_credentials) are never exposed to any end user; only the
-- service role, used by server-side sync code, can read them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper predicates.
--
-- SECURITY DEFINER so that policies on public.profiles can call is_admin()
-- without recursively re-evaluating those same policies.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active
  );
$$;

comment on function public.is_admin() is 'True when the calling user is an active admin.';

create or replace function public.has_shop_access(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.shop_assignments a
      join public.profiles p on p.id = a.user_id
      where a.shop_id = p_shop_id
        and a.user_id = auth.uid()
        and p.is_active
    );
$$;

comment on function public.has_shop_access(uuid) is
  'True when the calling user is an admin or has been assigned the given shop.';

create or replace function public.can_view_metric(p_shop_id uuid, p_metric text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.shop_assignments a
      join public.profiles p on p.id = a.user_id
      where a.shop_id = p_shop_id
        and a.user_id = auth.uid()
        and p.is_active
        and p_metric = any (a.metrics)
    );
$$;

comment on function public.can_view_metric(uuid, text) is
  'True when the calling user may see a specific metric for a specific shop.';

-- Shops the caller may read, as a set — used to keep analytics RPCs efficient.
create or replace function public.accessible_shop_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
  from public.shops s
  where public.is_admin()
  union
  select a.shop_id
  from public.shop_assignments a
  join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid()
    and p.is_active;
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_shop_access(uuid) to authenticated;
grant execute on function public.can_view_metric(uuid, text) to authenticated;
grant execute on function public.accessible_shop_ids() to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere. Tables with no policy are readable by service role only.
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.shops             enable row level security;
alter table public.shop_credentials  enable row level security;
alter table public.shop_assignments  enable row level security;
alter table public.metric_keys       enable row level security;
alter table public.ps_orders         enable row level security;
alter table public.ps_customers      enable row level security;
alter table public.ps_order_states   enable row level security;
alter table public.ps_currencies     enable row level security;
alter table public.sync_runs         enable row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy "profiles: read own or admin reads all"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "profiles: update own display name"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: admins manage all"
  on public.profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- A non-admin must not be able to change their own role or reactivate themselves.
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Only an administrator can change a user role.'
      using errcode = '42501';
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'Only an administrator can change account status.'
      using errcode = '42501';
  end if;

  -- Email is owned by auth.users; keep the mirror in step with it.
  new.email := old.email;

  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- -----------------------------------------------------------------------------
-- shops — marketers read the ones assigned to them, admins manage everything
-- -----------------------------------------------------------------------------
create policy "shops: read when accessible"
  on public.shops for select
  to authenticated
  using (public.has_shop_access(id));

create policy "shops: admins manage"
  on public.shops for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- shop_credentials — deliberately no policies: service role only.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- shop_assignments
-- -----------------------------------------------------------------------------
create policy "assignments: read own or admin reads all"
  on public.shop_assignments for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "assignments: admins manage"
  on public.shop_assignments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- metric_keys — a public catalogue, readable by any signed-in user
-- -----------------------------------------------------------------------------
create policy "metric_keys: readable by authenticated users"
  on public.metric_keys for select
  to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- Synced PrestaShop data — readable for accessible shops, written by sync only
-- -----------------------------------------------------------------------------
create policy "orders: read when shop accessible"
  on public.ps_orders for select
  to authenticated
  using (public.has_shop_access(shop_id));

create policy "customers: read when shop accessible"
  on public.ps_customers for select
  to authenticated
  using (public.has_shop_access(shop_id));

create policy "order states: read when shop accessible"
  on public.ps_order_states for select
  to authenticated
  using (public.has_shop_access(shop_id));

create policy "currencies: read when shop accessible"
  on public.ps_currencies for select
  to authenticated
  using (public.has_shop_access(shop_id));

-- -----------------------------------------------------------------------------
-- sync_runs — admins see the full history, marketers only their shops'
-- -----------------------------------------------------------------------------
create policy "sync runs: read when shop accessible"
  on public.sync_runs for select
  to authenticated
  using (public.has_shop_access(shop_id));

create policy "sync runs: admins manage"
  on public.sync_runs for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
