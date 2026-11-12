# Database

Use PostgreSQL 17. See [the operational guide](../README.md) for setup, backups, upgrades and initial Dean provisioning.

Migrations 0001–0003 establish the base schema, transactional workflow and immutable stock references. Migration 0004 is the additive integrity upgrade: revision checks, invoice deduplication, structured bill data, live actor guards, durable before/after ledgers, atomic top-ups and account closure.

Migration 0005 is a data-neutral validation upgrade: purchase value must equal quantity-weighted items plus charges, bill date cannot follow delivery/installation, consumables must use consumable groups, and PDA is a permitted fund code. Run 0004 then 0005 on every upgrade; the latter replaces `fn_validate_bill`. Existing rows/timestamps/balances/events are not modified by 0005.

Migration 0012 adds the `fund_sources` master (PDA, OH-31 and OH-35 seeded as standing sources; the Dean approves others), lets any approved budget head hold money like OH-31 and OH-35, and records where a bill was entered in the physical registers (`bills.register_name`, `register_page`, `register_serial`, mandatory in `fn_validate_bill`). It is additive and repeatable, changes no existing bill, balance or register entry, and replaces `fn_validate_bill`, `fn_validate_fund`, `fn_pool_for` and `fn_add_fund_allocation`, so every upgrade must run through 0012: rerunning an earlier migration alone restores the older rules.

For a **fresh empty** database, run `npm run db:setup`. For an **existing** database, back up first and run `npm run db:upgrade`. Never run 0001 or delete a Docker volume to upgrade. Demo login is retained; the optional `seed/0003_demo_data.sql` only adds missing demo accounts and starter balances without modifying existing records. Run it manually only on a demo database; see the operational guide for credentials and the seed command.

The account invariant is:

```text
allocated = balance + committed + spent
```

Submission reserves funds; rejection releases them; final approval settles them and records exactly one purchase-register entry. Only held bills can be corrected. Corrections preserve their before/after snapshots and restart the required approval route.

The public workflow entry points are `fn_submit_bill`, `fn_bill_action`, `fn_amend_bill` and `fn_note_bill`. PDA management uses `fn_set_pda_allocation`, `fn_top_up_pda` and `fn_close_pda`. The retained `*_engine` functions are internal settlement implementations, not API entry points.

`bill_approvals`, `purchase_register` and `change_log` are append-only. The latter records employee/PDA changes and complete bill revisions, with the actor set in the same transaction. Closed accounts remain in the database. Financial years and register dates use Asia/Kolkata, and numbering widths expand without truncation.

Legacy rows remain intact. New constraints marked `NOT VALID` enforce new/changed rows without rewriting historical anomalies. Reconcile those anomalies before validating the constraints. Case-insensitive employee-code collisions require administrator resolution before migration can succeed.

`npm run db:test` creates its own temporary cluster, exercises real transactions and concurrency, and stops the cluster. Never point `TEST_DATABASE_URL` at an application database: the integration suite creates and updates fixtures.

Database credentials stay server-side. RLS is not enabled; the server enforces read scope and the workflow functions enforce financial write rules. Restrict database network access to the application/administrators and protect backups.
