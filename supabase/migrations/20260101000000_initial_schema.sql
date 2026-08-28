-- =============================================================================
-- PS Data — core schema
-- Multi-shop PrestaShop order analytics with Admin / Marketer access control.
--
-- Privacy note: no personally identifiable customer data is ever stored here.
-- The sync engine never requests names, emails, phone numbers or addresses from
-- the PrestaShop Webservice. Only pseudonymous numeric shop-local identifiers,
-- timestamps and monetary aggregates are persisted.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'marketer');

create type public.ps_version as enum ('1.7', '8', '9');

create type public.sync_status as enum ('pending', 'running', 'success', 'partial', 'failed');

-- -----------------------------------------------------------------------------
-- profiles — one row per auth user, carries the role
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.user_role not null default 'marketer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'Application profile and role for each authenticated user.';

create index profiles_role_idx on public.profiles (role);

-- -----------------------------------------------------------------------------
-- shops — a connected PrestaShop installation
-- -----------------------------------------------------------------------------
create table public.shops (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  base_url          text not null,
  ps_version        public.ps_version not null default '8',
  detected_version  text,
  currency_code     text not null default 'EUR',
  timezone          text not null default 'UTC',
  is_active         boolean not null default true,
  last_sync_at      timestamptz,
  last_sync_status  public.sync_status,
  last_sync_error   text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint shops_name_not_blank check (length(btrim(name)) > 0),
  constraint shops_base_url_https check (base_url ~* '^https?://')
);

comment on table public.shops is 'A connected PrestaShop installation. Credentials live in shop_credentials.';

create index shops_active_idx on public.shops (is_active);

-- -----------------------------------------------------------------------------
-- shop_credentials — encrypted webservice keys, never readable by clients
-- -----------------------------------------------------------------------------
create table public.shop_credentials (
  shop_id           uuid primary key references public.shops (id) on delete cascade,
  api_key_cipher    text not null,
  key_fingerprint   text not null,
  updated_at        timestamptz not null default now()
);

comment on table public.shop_credentials is
  'AES-256-GCM encrypted PrestaShop webservice keys. Service role access only — no RLS policy grants access to end users.';

-- -----------------------------------------------------------------------------
-- Metric permission keys — what a marketer is allowed to see per shop
-- -----------------------------------------------------------------------------
create table public.metric_keys (
  key          text primary key,
  label        text not null,
  description  text not null,
  sort_order   int  not null default 0
);

comment on table public.metric_keys is 'Catalogue of togglable dashboard widgets/metrics.';

insert into public.metric_keys (key, label, description, sort_order) values
  ('revenue',          'Revenue',              'Total order value over the selected period.',       10),
  ('orders',           'Orders',               'Number of orders placed.',                          20),
  ('customers',        'Registered customers', 'Customer registrations over the period.',           30),
  ('aov',              'Average order value',  'Revenue divided by order count.',                   40),
  ('trends',           'Trend charts',         'Time-series charts for revenue and order volume.',  50),
  ('status_breakdown', 'Order statuses',       'Distribution of orders across PrestaShop statuses.', 60),
  ('payment_methods',  'Payment methods',      'Distribution of orders across payment modules.',    70),
  ('returning',        'New vs returning',     'Split of orders from first-time and repeat buyers.', 80),
  ('export',           'CSV export',           'Permission to download the aggregated figures.',    90);

-- -----------------------------------------------------------------------------
-- shop_assignments — which marketer sees which shop, and which metrics
-- -----------------------------------------------------------------------------
create table public.shop_assignments (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  metrics      text[] not null default array[
                 'revenue','orders','customers','aov','trends',
                 'status_breakdown','payment_methods','returning'
               ]::text[],
  granted_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (shop_id, user_id)
);

comment on table public.shop_assignments is
  'Grants a user access to a shop and defines which metrics they may see.';

create index shop_assignments_user_idx on public.shop_assignments (user_id);
create index shop_assignments_shop_idx on public.shop_assignments (shop_id);

-- -----------------------------------------------------------------------------
-- ps_order_states — mirrored PrestaShop order statuses
-- -----------------------------------------------------------------------------
create table public.ps_order_states (
  shop_id     uuid not null references public.shops (id) on delete cascade,
  ps_state_id int  not null,
  name        text not null,
  color       text,
  is_paid     boolean not null default false,
  is_shipped  boolean not null default false,
  is_deleted  boolean not null default false,
  synced_at   timestamptz not null default now(),
  primary key (shop_id, ps_state_id)
);

-- -----------------------------------------------------------------------------
-- ps_currencies — mirrored currencies for conversion display
-- -----------------------------------------------------------------------------
create table public.ps_currencies (
  shop_id         uuid not null references public.shops (id) on delete cascade,
  ps_currency_id  int  not null,
  iso_code        text not null,
  conversion_rate numeric(16, 6) not null default 1,
  synced_at       timestamptz not null default now(),
  primary key (shop_id, ps_currency_id)
);

-- -----------------------------------------------------------------------------
-- ps_orders — anonymised order facts
-- -----------------------------------------------------------------------------
create table public.ps_orders (
  id                    bigint generated always as identity primary key,
  shop_id               uuid not null references public.shops (id) on delete cascade,
  ps_order_id           int  not null,
  reference             text,
  ps_customer_id        int,
  current_state         int,
  payment_method        text,
  module                text,
  is_valid              boolean not null default false,
  currency_code         text,
  conversion_rate       numeric(16, 6) not null default 1,
  -- Amounts as charged, in the order's own currency.
  total_paid            numeric(14, 4) not null default 0,
  total_paid_real       numeric(14, 4) not null default 0,
  total_products        numeric(14, 4) not null default 0,
  total_shipping        numeric(14, 4) not null default 0,
  total_discounts       numeric(14, 4) not null default 0,
  -- Amount normalised to the shop's default currency (total_paid / conversion_rate).
  total_paid_base       numeric(14, 4) not null default 0,
  date_add              timestamptz not null,
  date_upd              timestamptz,
  synced_at             timestamptz not null default now(),
  unique (shop_id, ps_order_id)
);

comment on table public.ps_orders is
  'Anonymised order facts. Contains no customer names, emails, phones or addresses.';

create index ps_orders_shop_date_idx on public.ps_orders (shop_id, date_add desc);
create index ps_orders_shop_state_idx on public.ps_orders (shop_id, current_state);
create index ps_orders_shop_customer_idx on public.ps_orders (shop_id, ps_customer_id);

-- -----------------------------------------------------------------------------
-- ps_customers — registration facts only
-- -----------------------------------------------------------------------------
create table public.ps_customers (
  id              bigint generated always as identity primary key,
  shop_id         uuid not null references public.shops (id) on delete cascade,
  ps_customer_id  int  not null,
  date_add        timestamptz not null,
  newsletter      boolean not null default false,
  optin           boolean not null default false,
  is_active       boolean not null default true,
  is_guest        boolean not null default false,
  synced_at       timestamptz not null default now(),
  unique (shop_id, ps_customer_id)
);

comment on table public.ps_customers is
  'Customer registration facts only — a shop-local numeric id plus signup date and flags. No PII.';

create index ps_customers_shop_date_idx on public.ps_customers (shop_id, date_add desc);

-- -----------------------------------------------------------------------------
-- sync_runs — audit trail of every synchronisation
-- -----------------------------------------------------------------------------
create table public.sync_runs (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops (id) on delete cascade,
  status            public.sync_status not null default 'running',
  trigger_source    text not null default 'manual',
  triggered_by      uuid references public.profiles (id) on delete set null,
  orders_synced     int not null default 0,
  customers_synced  int not null default 0,
  error_message     text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  duration_ms       int
);

create index sync_runs_shop_idx on public.sync_runs (shop_id, started_at desc);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger shops_touch_updated_at
  before update on public.shops
  for each row execute function public.touch_updated_at();

create trigger shop_assignments_touch_updated_at
  before update on public.shop_assignments
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- New auth users automatically receive a profile.
-- The very first user to sign up becomes the admin; everyone else is a marketer.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  assigned_role public.user_role;
begin
  if exists (select 1 from public.profiles) then
    assigned_role := 'marketer';
  else
    assigned_role := 'admin';
  end if;

  -- The role is deliberately NOT read from raw_user_meta_data: that field is
  -- attacker-controlled at sign-up time and would allow self-promotion to admin.
  -- Roles are only ever changed by an existing admin through the admin panel.
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    assigned_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
