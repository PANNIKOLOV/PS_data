# Working notes

## Branch

`main` is the development branch. Work on `main` and push to `main` — do not
open feature branches unless asked for one specifically.

## Verify before pushing

```bash
npm run verify   # typecheck + lint + unit tests + production build
npm run test:db  # SQL regression suite (needs PostgreSQL server binaries)
```

`npm run test:db` spins up a throwaway PostgreSQL cluster, applies the
migrations and runs the assertions. It never touches the Supabase project. It
needs `initdb`/`pg_ctl` on `PATH` or under `/usr/lib/postgresql/*/bin`, and
PostgreSQL refuses to run as root — use an unprivileged user if necessary.

## Things that are easy to get wrong

**Access control lives in the database.** `src/lib/permissions.ts` decides what
the interface renders; Row Level Security in `supabase/migrations/` decides what
a query may return. Changing one without the other creates a gap. Any change to
roles, assignments or metric visibility needs a matching assertion in
`supabase/tests/rls_and_analytics_test.sql`.

**Analytics RPCs are SECURITY INVOKER on purpose.** That is what makes RLS apply
to them, so a caller cannot widen their result set by passing shop ids they were
not assigned. Do not switch them to SECURITY DEFINER.

**Never read a role from user-supplied metadata.** `raw_user_meta_data` is
attacker-controlled at sign-up. Roles are set only by an existing admin.

**Every server action re-checks the caller.** A server action is a POST
endpoint; the layout that rendered its form does not protect it. Start each one
with `requireAdmin()` or `requireUser()`.

**Privacy boundary.** The field lists in `src/lib/prestashop/resources.ts` are
the only fields ever requested from PrestaShop, and `display=full` is never
used. Adding a field there is a privacy decision, and a test enforces it.

**PrestaShop timestamps are naive local time.** They carry no UTC offset, so
they must be parsed against the shop's configured timezone. Period boundaries
and chart buckets use that same timezone, not the viewer's.

**Migrations are applied in filename order** and the grants file runs last,
because it references the analytics functions.

## Environment

Four variables are required; see `.env.example`. `CREDENTIALS_ENCRYPTION_KEY`
encrypts stored PrestaShop webservice keys — changing it makes existing keys
unreadable.
