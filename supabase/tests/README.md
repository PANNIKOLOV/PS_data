# Database tests

Regression tests for access control and analytics aggregation, run against a
throwaway PostgreSQL cluster. They never touch your Supabase project.

```bash
npm run test:db
```

A clean run means every assertion passed; each check raises an exception on
failure, and the run ends with `ALL CHECKS PASSED`.

## Requirements

PostgreSQL **server** binaries (`initdb`, `pg_ctl`), either on `PATH` or under
`/usr/lib/postgresql/*/bin`. The `psql` client alone is not enough.

- Debian/Ubuntu — `apt install postgresql`
- macOS — `brew install postgresql@16`

## Files

| File | Purpose |
| --- | --- |
| `run-tests.sh` | Creates a temporary cluster, applies migrations, runs the suite |
| `_supabase_stub.sql` | Minimal stand-in for `auth.users`, `auth.uid()` and the Supabase roles |
| `rls_and_analytics_test.sql` | The assertions |

The stub exists because the migrations reference objects a hosted Supabase
project provides. It grants the `authenticated` role `USAGE` on the `auth`
schema and `EXECUTE` on `auth.uid()`, matching hosted Supabase, so the policies
behave locally exactly as they do in production.

`set request.jwt.claim.sub` impersonates a user, which is how the suite checks
the same query returns different results for an admin and for a marketer.

## What is covered

**Roles** — the first sign-up becomes an admin and later ones do not; a marketer
cannot promote themselves or reactivate their own account.

**Isolation** — a marketer sees only assigned shops and their orders; an
unassigned user sees nothing; the `anon` role is refused at the privilege layer
before RLS is even consulted; webservice credentials are unreachable with any
user token.

**RPC scoping** — the important one. A marketer passing an unassigned shop id
into an analytics function still receives only their own data. Interface-level
permission checks are not what makes this safe, so it is asserted directly.

**Aggregation** — daily, monthly, quarterly and yearly bucketing; zero-filling
of empty buckets; the paid-orders-only filter; timezone bucketing, including an
order that falls on a different local day than its UTC day; fallback to UTC for
an invalid timezone; status, payment and first-time/returning breakdowns.

**The marketer sync cap** — the other important one. `claim_manual_sync` allows
the shop's daily allowance and refuses the next; refuses a second run while one
is in flight; refuses a paused shop, a shop with no allowance, and a shop the
caller was not assigned; and does not cap admins. The allowance window is the
shop's own day, so a run one minute before local midnight belongs to yesterday
even when the UTC date has not changed, and scheduled runs never count against a
marketer. The routes around it are asserted too: a marketer can neither insert
sync history, delete it to win the allowance back, nor raise the shop's limit.

## Adding a test

Add assertions with the `pg_temp.check_eq` helper inside a `do $$ … $$` block:

```sql
perform pg_temp.check_eq('what this proves', <actual>, <expected>);
```

To assert something is *refused*, catch the error and check the flag:

```sql
begin
  perform 1 from public.shop_credentials;
  v_denied := false;
exception when insufficient_privilege then
  v_denied := true;
end;
perform pg_temp.check_eq('credentials are denied', v_denied, true);
```

Switch identity with `set role authenticated;` plus
`set request.jwt.claim.sub = '<uuid>';`, and reset both afterwards.
