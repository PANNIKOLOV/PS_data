# PS Data

Order analytics across multiple PrestaShop stores, with per-shop access control
for marketing teams.

Connect PrestaShop 1.7.8, 8.x or 9.x stores, and the platform syncs their order
and customer-registration figures into Supabase. Administrators decide which
shops each marketer can see — and, per shop, exactly which figures.

**No personal data is collected.** Customer names, email addresses, phone
numbers and postal addresses are never requested from the shop, so they never
transit the network or reach the database.

---

## Contents

- [What it shows](#what-it-shows)
- [Roles and permissions](#roles-and-permissions)
- [Requirements](#requirements)
- [Setup](#setup)
  - [1. Create the Supabase project](#1-create-the-supabase-project)
  - [2. Apply the migrations](#2-apply-the-migrations)
  - [3. Configure the application](#3-configure-the-application)
  - [4. Create the first administrator](#4-create-the-first-administrator)
  - [5. Prepare the PrestaShop webservice](#5-prepare-the-prestashop-webservice)
  - [6. Connect a shop](#6-connect-a-shop)
- [Scheduled synchronisation](#scheduled-synchronisation)
- [How it works](#how-it-works)
- [Privacy](#privacy)
- [Development](#development)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## What it shows

Every figure can be viewed **daily, weekly, monthly, quarterly or yearly**, over
presets from *Today* through *Last 12 months*, with each period compared against
the one immediately before it.

| Metric | Description |
| --- | --- |
| Revenue | Total order value, normalised to the shop's default currency |
| Orders | Order count, optionally restricted to paid/validated orders |
| Registered customers | New customer accounts created in the period |
| Average order value | Revenue divided by order count |
| Trend charts | Revenue, order volume and registrations over time |
| Order statuses | Distribution across the shop's own PrestaShop statuses |
| Payment methods | Distribution across payment modules |
| New vs returning | Orders split by whether the buyer had ordered before |
| CSV export | Download of the figures currently on screen |

Amounts are converted into the shop's default currency using each order's own
`conversion_rate`, so a shop selling in several currencies still totals
correctly. When a cross-shop view spans shops with different base currencies,
the dashboard says so rather than presenting a misleading sum.

All time bucketing happens in **the shop's own timezone**, so "yesterday" means
yesterday in the shop's terms, not the viewer's.

## Roles and permissions

**Admin** — connects and configures shops, manages users, triggers syncs, and
sees every figure for every shop.

**Marketer** — sees only the shops an admin has assigned, and within each shop
only the metrics that admin ticked. A marketer assigned Shop A with revenue and
orders enabled sees exactly that: no Shop B, and no payment breakdown.

Permissions are enforced in the database by Row Level Security, not merely
hidden in the interface. A marketer who crafts a request naming a shop they were
not assigned still receives only their own data — this is covered by the
[SQL regression suite](supabase/tests/rls_and_analytics_test.sql).

## Requirements

- Node.js 20 or newer
- A Supabase project (the free tier is sufficient to start)
- A PrestaShop 1.7.8, 8.x or 9.x store with the webservice enabled

## Setup

### 1. Create the Supabase project

Create a project at [supabase.com](https://supabase.com), then from
**Project Settings → API** note the project URL, the `anon` key and the
`service_role` key.

### 2. Apply the migrations

The files in `supabase/migrations/` must be applied **in filename order**.

Using the Supabase CLI:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or paste each file into the dashboard SQL editor, in this order:

1. `20260101000000_initial_schema.sql` — tables, enums, triggers
2. `20260101000100_row_level_security.sql` — policies and access predicates
3. `20260101000200_analytics_functions.sql` — aggregation RPCs
4. `20260101000300_grants.sql` — explicit privilege grants
5. `20260101000400_harden_function_grants.sql` — revokes the implicit PUBLIC
   EXECUTE grant and pins `search_path`

### 3. Configure the application

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CREDENTIALS_ENCRYPTION_KEY=   # openssl rand -base64 32
```

`CREDENTIALS_ENCRYPTION_KEY` encrypts PrestaShop webservice keys before they are
stored. Generate it with `openssl rand -base64 32` and keep it safe —
**changing it makes existing stored keys unreadable**, and they will need to be
re-entered.

```bash
npm run dev
```

### 4. Create the first administrator

The first account to exist becomes the administrator automatically; every
account after that is created as a marketer. Create it from the Supabase
dashboard under **Authentication → Users → Add user** (tick *Auto Confirm User*),
then sign in at `/login`.

From then on, add users from **Users & access** inside the application rather
than the Supabase dashboard, so their role is set at the same time.

> Roles can never be self-assigned. The sign-up trigger deliberately ignores
> user metadata, so an account cannot request the admin role for itself.

### 5. Prepare the PrestaShop webservice

In the shop's back office:

1. Go to **Advanced Parameters → Webservice** and enable the webservice.
2. **Add a new webservice key** and copy the generated key.
3. Grant that key **GET (view)** permission on exactly these resources:
   `orders`, `customers`, `order_states`, `currencies`.

No write permission is needed anywhere. If the shop sits behind basic auth or a
firewall, allow the application's outbound address.

> PrestaShop 9 also ships a newer OAuth2 Admin API. This platform uses the
> classic `/api` webservice, which 9.x still supports, so one integration covers
> 1.7.8, 8.x and 9.x.

### 6. Connect a shop

In the application, go to **Manage shops → Connect shop** and enter the shop URL,
version, default currency, timezone and webservice key.

The connection is tested before anything is saved, so a shop is never stored in
a state that cannot sync. Then:

1. Open the shop and run **Full resync** to import its order history.
2. Go to **Users & access**, assign the shop to a marketer, and tick the figures
   they should see.

The **shop timezone must match the shop's own setting**. PrestaShop stores dates
without a UTC offset, so a mismatch shifts every figure by the difference.

## Scheduled synchronisation

`POST /api/cron/sync` syncs every active shop incrementally. Set
`SYNC_CRON_SECRET` (`openssl rand -hex 32`) to enable it; while it is unset the
endpoint stays closed rather than open.

```bash
curl -X POST https://your-app.example.com/api/cron/sync \
     -H "Authorization: Bearer $SYNC_CRON_SECRET"
```

On Vercel, add to `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/sync", "schedule": "0 */6 * * *" }] }
```

Each run re-reads a one-hour overlap so records modified during the previous run
are not missed, and one unreachable shop does not abandon the rest of the run.

## How it works

```
PrestaShop shops                This application              Supabase
─────────────────               ─────────────────             ──────────────
/api/orders        ──┐
/api/customers     ──┤ sync engine ─► anonymised facts ──►    ps_orders
/api/order_states  ──┤ (service role)                         ps_customers
/api/currencies    ──┘                                        ps_order_states
                                                              ps_currencies
                                                                   │
Browser ◄── dashboard ◄── analytics RPCs ◄── Row Level Security ────┘
                          (caller's own session)
```

Dashboard reads always travel through the signed-in user's own session, so Row
Level Security scopes them. The service role is used only by the sync engine and
admin provisioning, which legitimately span tenants.

| Path | Contents |
| --- | --- |
| `src/lib/prestashop/` | Webservice client, field selections, sync engine |
| `src/lib/analytics/` | Period resolution, query layer, parameter validation |
| `src/lib/supabase/` | Browser, server and service-role clients; schema types |
| `src/lib/permissions.ts` | Metric catalogue and visibility helpers |
| `src/app/(app)/` | Signed-in application, including the admin panel |
| `supabase/migrations/` | Schema, RLS policies, RPCs, grants |
| `supabase/tests/` | SQL regression suite and its local harness |

## Privacy

The privacy promise is structural rather than procedural: the field lists in
`src/lib/prestashop/resources.ts` are the only fields ever requested, and
`display=full` is never used.

**Collected:** order id and reference, order date, status, payment module,
currency, monetary totals, validity flag, a shop-local numeric customer id, and
customer account creation dates with newsletter/active flags.

**Never requested or stored:** names, email addresses, phone numbers, postal
addresses, delivery or invoice address ids, VAT or tax identifiers, birthdays,
company names, IP addresses, product-level line items.

The numeric `id_customer` is retained because new-versus-returning analysis is
impossible without it. It is meaningless outside its source shop and is never
joined to identifying data. If you do not need that breakdown, remove it from
`ORDER_FIELDS`; the accompanying test will confirm the change.

Webservice keys are encrypted with AES-256-GCM before storage, in a table no
end-user role can read — only the service role can reach it.

## Development

```bash
npm run dev        # development server
npm run build      # production build
npm run typecheck  # TypeScript, no emit
npm run lint       # ESLint
npm run test       # unit tests (74)
npm run test:db    # SQL regression suite (35 assertions)
npm run verify     # typecheck + lint + test + build
```

`npm run test:db` starts a throwaway PostgreSQL cluster, applies the migrations
and runs the assertions. It needs PostgreSQL **server** binaries (`initdb`,
`pg_ctl`) on `PATH` or under `/usr/lib/postgresql/*/bin`, and never touches your
Supabase project. On Debian or Ubuntu: `apt install postgresql`.

After changing a migration, regenerate the database types:

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```

## Deployment

Deploy as a standard Next.js application. Set the same four environment
variables in the host, plus `SYNC_CRON_SECRET` if you want scheduled syncing.

A full resync of a large store can take minutes. On platforms with short
function timeouts, prefer incremental syncs on a schedule and run the initial
full import from a longer-lived environment.

## Troubleshooting

**"Authentication failed (401)"** — the key was rejected. Confirm it is enabled
under Advanced Parameters → Webservice and copy it again; keys are easy to
truncate.

**"Access denied (403)"** — the key exists but lacks permission. Grant GET on
`orders`, `customers`, `order_states` and `currencies`.

**"Not found (404)"** — the webservice is disabled, or URL rewriting is off.
Enable both in the shop back office.

**"Shop returned a non-JSON response"** — usually a maintenance page, a security
module, or a WAF between the application and the shop. Try the same URL with
`?output_format=JSON` in a browser while authenticated.

**Figures are off by a few hours** — the shop timezone recorded here does not
match the shop's own configuration. Correct it and run a full resync.

**Revenue looks too high or too low** — check whether *Paid orders only* matches
your intent. Unticked, every order is counted, including cancelled and unpaid
ones.

**A marketer sees nothing** — confirm the shop is assigned to them under
Users & access, that at least one metric is ticked, and that their account is
active.
