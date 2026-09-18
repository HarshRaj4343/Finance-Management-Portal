# Database

Everything the portal stores, and the entire approval workflow, lives here.

```
db/
  migrations/
    0001_schema.sql       tables, constraints, append-only triggers
    0002_functions.sql    the workflow engine
  seed/
    0003_demo_data.sql    realistic IIT Mandi demo dataset
```

## Setting up a database

Any PostgreSQL 13 or newer. Point `DATABASE_URL` at it and run:

```bash
npm run db:setup              # schema + functions + demo data
npm run db:setup -- --no-seed # schema + functions only
```

`scripts/db-setup.sh` creates the database if it does not exist, then runs
the three files **in order**. By hand, that is:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0002_functions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed/0003_demo_data.sql   # optional
```

With Docker, `docker compose up` starts a `db` service that runs the same
three files the first time its volume is created.

`0001` drops the tables it is about to create, so re-running it during
development is safe — and destructive. `db:setup` refuses to run over a
database that already holds bills unless `FORCE=1` is set. The seed truncates the
transactional tables before it writes, so it is also safe to re-run.

## Why the workflow lives in the database

Every state change goes through one of four functions:

| Function | What it does |
|---|---|
| `fn_submit_bill` | Checks the PDA, creates the bill, reserves the money, writes the first events — one transaction |
| `fn_bill_action` | Approve / reject / hold. Validates the desk, moves the bill, settles the money, cuts the register entry |
| `fn_amend_bill` | Corrects a held bill and moves its reservation with the amount |
| `fn_set_pda_allocation` | Changes an allocation without touching committed or spent money |

The prototype did this from the browser, in several separate statements.
A bill was inserted, then the PDA was debited in a second call. If the
second one failed, the bill existed and the money did not move — and
nothing said so. A rejection never gave the money back at all.

Putting it in the database means the bill, the money, the event log and the
register cannot disagree, because they are written together or not at all.

## The four PDA columns

```
allocated = balance + committed + spent
```

- `allocated` — the total granted to this person
- `balance` — free to commit to a new bill (this is what the UI shows)
- `committed` — reserved by bills still moving through the workflow
- `spent` — finally approved and gone

A `CHECK` constraint enforces the identity on every write, so a bug that
breaks it fails loudly rather than quietly losing money.

Reserve on submit, release on rejection, settle on final approval.

## The two ledgers

`bill_approvals` is the workflow event log — one row every time anything
happens to a bill: who, what, when, from which desk, with what remark.

`purchase_register` is the departmental register — one row per finally
approved purchase, under a running serial number issued per department per
financial year (`SCEE/2026-27/0007`). This is the answer to "where is this
purchase actually logged".

Both have `BEFORE UPDATE OR DELETE` triggers that raise an exception. They
are append-only, and the database will not be talked out of it:

```sql
UPDATE public.purchase_register SET amount = 1;
-- ERROR: purchase_register is append-only; UPDATE is not permitted
```

The one exception is the seed script, which lifts the triggers to back-date
its own data and puts them straight back.

## Serial number formats

Both are demo formats. Change them in one place each:

- `fn_next_bill_number` → `IITM/2026-27/00042`
- `fn_next_register_serial` → `SCEE/2026-27/0007`

They use `fn_next_counter`, which locks a row rather than using a sequence,
because a register may not skip numbers and a sequence leaks gaps on
rollback.

## Testing it

`scripts/test_workflow.sql` runs 44 assertions against a real Postgres —
routing at the ₹50,000 boundary, reservation and release, rejection being
terminal, the append-only triggers, the allocation guard, financial-year
arithmetic.

```bash
# against a throwaway local cluster
initdb -D /tmp/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 55999 -k /tmp" start
psql -h /tmp -p 55999 -U postgres -v ON_ERROR_STOP=1 \
  -f db/migrations/0001_schema.sql \
  -f db/migrations/0002_functions.sql \
  -f scripts/test_workflow.sql
```

It ends with `ALL WORKFLOW TESTS PASSED`, or stops at the first failure.

## Row-level security

Still off, deliberately. Every read and write goes through an API route
using the server's `DATABASE_URL`, and those routes resolve the caller's
role from `employees` before they do anything — the browser holds no
database credentials at all. RLS would be a second line of defence, not the
first one, and is the obvious next thing to add.
