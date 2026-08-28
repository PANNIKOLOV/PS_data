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
  - [cPanel (Phusion Passenger)](#cpanel-phusion-passenger)
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

### cPanel (Phusion Passenger)

`app.js` in the repository root is the Passenger entry point. It mounts Next
behind its own HTTP server using the framework's request handler, so
middleware, server actions and static assets behave exactly as they do under
`next start`.

**Do not replace it with the "It works!" placeholder cPanel generates** — that
file serves a plain-text page and will not run this application.

#### 1. Choose the Node version

In **Setup Node.js App**, pick **Node 20 or newer**. Next.js 15 does not run on
older versions.

#### 2. Create the application

| Field | Value |
| --- | --- |
| Application root | where you upload the project, e.g. `ps-data` |
| Application URL | the domain or subdomain to serve it from |
| Application startup file | `app.js` |

#### 3. Set the environment variables

**Create a `.env.local` file in the application root**, rather than using the
control panel's environment editor:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key>
CREDENTIALS_ENCRYPTION_KEY=<openssl rand -base64 32>
```

The panel injects variables into the process Passenger starts, but not into the
SSH session you build from — so a build run by hand cannot see them, and fails
while collecting page data. A `.env.local` file is read in both places: Next
loads it during `next build`, and `app.prepare()` loads it at run time.

Keep the file readable only by your account (`chmod 600 .env.local`); it holds
the service-role key.

> **The two `NEXT_PUBLIC_` variables are read at build time, not run time.**
> Next inlines them into the client bundle during `npm run build`, so they must
> already be set before you build. The build fails with an explanatory message
> if they are missing, rather than producing an application that only breaks
> once someone opens it.
>
> The others (`SUPABASE_SERVICE_ROLE_KEY`, `CREDENTIALS_ENCRYPTION_KEY`,
> `SYNC_CRON_SECRET`) are read at run time, so changing those needs only a
> restart — no rebuild.

#### 4. Install and build over SSH

Passenger does not build for you. cPanel shows an "Enter to the virtual
environment" command at the top of the app's page — run that first, so `node`
and `npm` resolve to the version you selected:

```bash
source /home/USERNAME/nodevenv/ps-data/20/bin/activate && cd ~/ps-data
npm ci
npm run build
```

Then press **Restart** in the cPanel interface.

> **Do not skip devDependencies.** TypeScript (`next.config.ts` is TypeScript,
> and the build typechecks), Tailwind and its PostCSS plugin are all
> devDependencies and all required to build.
>
> npm treats `NODE_ENV=production` as `--omit=dev`, so on a host that sets it —
> cPanel's Node.js selector does, once the application mode is Production — a
> plain `npm ci` quietly installs 82 packages instead of 389 and the build then
> fails loading `next.config.ts`. The repository ships an `.npmrc` with
> `include=dev` so this is handled without anyone having to remember it. If you
> install with different tooling, pass `--include=dev` explicitly.

#### Building elsewhere

The build needs roughly **1 GB of memory**, which is above some shared-hosting
caps. If it gets killed, build on your own machine and upload the result.

Only a small part of `.next` is needed to run. Upload everything except the
build cache:

```bash
npm run build
rm -rf .next/cache          # ~187 MB of local build cache, not needed to serve
# upload the remaining .next directory (~7 MB) to the application root
```

`.next` is deliberately excluded from git, so it is never present after a
`git pull` — it has to be built or uploaded separately every time the source
changes.

#### Serving from a sub-path

If the Application URL is a folder rather than the domain root — say
`https://example.com/psdata` — set the base path as well:

```ini
NEXT_PUBLIC_BASE_PATH=/psdata
```

Without it the app builds and starts, but every internal redirect drops the
prefix: opening `/psdata` bounces to `/login` instead of `/psdata/login`, which
is a 404. Symptom to recognise:

```
https://example.com/psdata  ->  https://example.com/login?next=%2Fpsdata   404
```

Use no trailing slash, and leave the variable unset at the domain root. Like
the other `NEXT_PUBLIC_` values it is baked in at build time, so **rebuild after
changing it**.

#### 5. Schedule the sync

Add a cPanel **Cron Job** (every six hours shown here):

```
0 */6 * * * curl -s -X POST https://your-domain.example/api/cron/sync -H "Authorization: Bearer YOUR_SYNC_CRON_SECRET" >/dev/null 2>&1
```

#### If the build dies after "Compiled successfully"

A crash like this, immediately after compilation succeeds, is a process quota
rather than a code problem:

```
uncaughtException [Error: spawn /opt/alt/alt-nodejs20/root/usr/bin/node EAGAIN]
Error: kill EPERM
```

`EAGAIN` on spawn means the host refused to create another process — CloudLinux
caps concurrent processes per user (LVE `nproc`). Next fans page generation out
across child processes and hits that ceiling. The `kill EPERM` afterwards is
cascade noise from Next cleaning up workers it never got.

`next.config.ts` already pins the build to a single worker (`cpus: 1`,
`workerThreads: false`, `webpackBuildWorker: false`), which keeps it inside a
tight process budget. This application prerenders three routes, so nothing is
lost by serialising the work.

If it still fails, raise the process limit for the account, or build elsewhere
and upload as described above.

#### Set the application mode to Production — this one breaks the build

A warning reading:

```
⚠ You are using a non-standard "NODE_ENV" value in your environment.
```

is not cosmetic. With `NODE_ENV` set to anything other than `production`, the
build compiles, typechecks and collects page data, then fails on the very last
step:

```
Error: <Html> should not be imported outside of pages/_document.
Error occurred prerendering page "/404".
Export encountered an error on /_error: /404, exiting the build.
```

Nothing in that message points at `NODE_ENV`, so it reads as a bug in the
application. It is not — setting `NODE_ENV=production` makes it build cleanly.

Set **Application mode** to *Production* on the Node.js app page. That fixes
both the build and the running app, which also misbehaves in development mode.

`NODE_ENV` **cannot** be fixed from `.env.local`: the value already present in
the environment wins, and Next still sees the wrong one. To build before the
panel setting takes effect, put it on the command line:

```bash
NODE_ENV=production npm run build
```

#### cPanel-specific gotchas

**"Could not find a production build"** — `npm run build` has not been run, or
was run outside the virtual environment so it wrote nothing usable. Re-run step
4 and restart.

**The build is killed part-way through.** Shared hosting often caps memory below
what a Next build needs. Build locally and upload `.next` instead.

**Changes do not appear.** Passenger caches the running process. Press
**Restart**, or `touch tmp/restart.txt` in the application root.

**Styles or scripts 404.** The application URL and the deployed path disagree.
Confirm the Application URL matches where you are browsing, and that the whole
`.next` directory was uploaded, not just its top level.

**Static export is not an option.** This application needs a running Node
process. `next export` cannot serve middleware, server actions or the sync API,
so the login and admin flows would silently stop working.

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
