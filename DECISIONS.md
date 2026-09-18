# Architecture & Engineering Decisions

This document records the major decisions taken while building the **Integrated Finance
Management Portal for IIT Mandi**, the reasoning behind each one, and the trade-offs
accepted.

Wherever a decision is visible in the system diagram, it is cross-referenced to
[`architecture.jpeg`](./architecture.jpeg) — the canonical picture of the login →
role-routing → approval-workflow pipeline.

![System Architecture](./architecture.jpeg)

**How to read the diagram**

| Region of `architecture.jpeg` | What it shows |
| --- | --- |
| Far left | `Login Portal → LDAP Authentication → Check Employee Type` |
| Green box (`EMPLOYEE LANDING`) | Finance / Audit / SNP / Apply Bill / PDA Manager / Bill Edit pages |
| Red box (`FINANCE ADMIN PANEL`) | View All Bills, Edit or Add Employees |
| Yellow box (`USER LANDING`) | Fallback landing — User Bills, PDA Balance |
| Blue box (`APPLY BILL WORKFLOW`) | The bill lifecycle from submission to QR generation |

---

## 1. Platform & Framework

### 1.1 Next.js 15 App Router as a single full-stack application
**Decision.** Build the entire portal — UI, auth, and server routes — as one Next.js 15
(App Router) + React 19 application instead of a separate SPA and API server.

**Why.**
- Every box in `architecture.jpeg` is a *page* (Finance Page, Audit Page, SNP Page,
  Apply Bill Page, PDA Manager Page, Bill Edit Page). A file-system router maps 1:1 onto
  that diagram, so `src/app/audit/page.tsx` *is* the "Audit Page" node.
- Server-side session reads (`getServerSession`) let the role gate run before render,
  which is what the `Check Employee Type` diamond in the diagram requires.
- One deploy artifact for a small team; no CORS or API versioning overhead.

**Trade-off.** Frontend and backend scale together; no independent API surface for
future mobile clients.

**Where.** `src/app/**`, `src/app/layout.tsx`

---

### 1.2 TypeScript everywhere, with a hand-written database type contract
**Decision.** TypeScript across the codebase, and a single generated-style
`Database` interface in `src/types/database.ts` describing `bills`, `employees`, and
`pda_balances` (Row / Insert / Update shapes).

**Why.** The `bills` table carries ~35 columns and four independent status fields
(`status`, `snp`, `audit`, `finance_admin`). A typed contract is what keeps the
workflow transitions in the blue `APPLY BILL WORKFLOW` region from silently writing an
invalid state.

**Where.** `src/types/database.ts`, `src/types/next-auth.d.ts`, `src/types/ldapjs.d.ts`

---

### 1.3 Build-time type and lint errors are deliberately non-blocking
**Decision.** `next.config.ts` sets `typescript.ignoreBuildErrors: true` and
`eslint.ignoreDuringBuilds: true`.

**Why.** The portal had to be demonstrable to the finance office on a fixed timeline;
type errors in in-progress screens were not allowed to block a deploy.

**Trade-off — accepted knowingly.** This is technical debt. Type errors reach
production instead of CI. The intent is to flip both flags off once the workflow
screens stabilise.

**Where.** `next.config.ts`

---

## 2. Authentication & Identity

### 2.1 Institute LDAP as the single source of identity (no local passwords)
**Decision.** Authenticate against the IIT Mandi LDAP directory. The portal stores no
password of its own.

This is the leftmost link in `architecture.jpeg`: `Login Portal → LDAP Authentication`.

**Why.**
- Staff and faculty already have institute credentials; a second credential store for a
  finance system would be both a security liability and an adoption barrier.
- Account lifecycle (joining, leaving) is handled by the institute directory for free.

**Implementation detail.** Bind is attempted against each configured OU in turn —
`students_ug`, `Faculty`, `Staff` — because the directory does not expose a single flat
search base for all portal users. First successful bind wins.

**Trade-off.** The portal only works from inside the institute network / VPN. The login
screen surfaces this explicitly ("please try again by connecting iit mandi network").

**Where.** `src/app/api/auth/[...nextauth]/route.ts` (`authenticateWithLDAP`)

---

### 2.2 NextAuth.js with a Credentials provider wrapping LDAP
**Decision.** Use NextAuth.js v4 and implement LDAP inside a `CredentialsProvider`'s
`authorize()` rather than writing bespoke session handling.

**Why.** NextAuth supplies CSRF protection, cookie handling, the session hook, and
`getServerSession` for server components. LDAP is simply the credential check inside it.

**Where.** `src/app/api/auth/[...nextauth]/route.ts`

---

### 2.3 JWT sessions, 8-hour lifetime, role baked into the token
**Decision.** `session.strategy = "jwt"` with `jwt.maxAge = 8 hours`. The `jwt` callback
copies `employee_type`, `employee_code`, `ou`, and `username` onto the token; the
`session` callback projects them onto `session.user`.

**Why.**
- No session table means no extra database round-trip on every page — important because
  the `Check Employee Type` decision in `architecture.jpeg` runs on *every* protected
  page load.
- Eight hours ≈ one working day: a staff member logs in once per shift.

**Trade-off.** A role change in the `employees` table does not take effect until the
user's token expires or they re-login. Acceptable, because role changes are rare
administrative events performed from the Finance Admin panel.

**Where.** `src/app/api/auth/[...nextauth]/route.ts` (callbacks), `src/types/next-auth.d.ts`

---

### 2.4 LDAP proves *who you are*; Supabase decides *what you may do*
**Decision.** Two-step identity. LDAP returns a verified `uid`. That `uid` is then looked
up in the `employees` table to resolve `employee_type`.

This is exactly the two-node sequence in `architecture.jpeg`:
`LDAP Authentication → Check Employee Type`.

**Why.** The institute directory has no concept of "Audit Employee" or "PDA Manager" —
those are portal-domain roles. Keeping them in application data means the finance office
can reassign roles themselves without an IT directory change request.

**Fallback.** A successful LDAP bind for someone with no `employees` row resolves to
`employee_type: 'User'` — the `No Employee Type Matched` branch in the diagram, which
lands on the yellow `USER LANDING` box.

**Where.** `src/app/api/supabase/index.ts` (`getEmployeeDetailsByUserId`)

---

### 2.5 A seeded set of demo logins bypasses LDAP
**Decision.** A fixed list of usernames (`Audit`, `User`, `Bill-form`, `Finance Admin`,
`SNP`, `Bill-edit`, `pda manager`, `E001`–`E008`) authenticates against a hard-coded
password instead of LDAP.

**Why.** The portal is unusable outside the institute network, which makes demos,
reviews, and off-campus development impossible. These accounts let every role in the
green/red/yellow boxes of `architecture.jpeg` be exercised without a VPN.

**Trade-off — must be removed before production.** This is a deliberate development
affordance with a known, shared password. It bypasses the entire control in §2.1 and is
the single highest-priority item to strip before a real rollout.

**Where.** `src/app/api/auth/[...nextauth]/route.ts` (`authorize`)

---

## 3. Authorization & Role Routing

### 3.1 Role-based landing pages, decided at login
**Decision.** After a successful sign-in, the client reads the session and redirects by
`employee_type` through an explicit route map:

| `employee_type` | Landing route | Diagram node |
| --- | --- | --- |
| `Finance Admin` | `/finance-admin` | Finance Page → Finance Admin Panel |
| `Audit` | `/audit` | Audit Page |
| `Student Purchase` | `/student-purchase` | SNP Page |
| `bill_employee_fill` | `/apply-bill` | Apply Bill Page |
| `bill_employee_edit` | `/bill-editor` | Bill Edit Page |
| `pda-manager` | `/pda-manager` | PDA Manager Page |
| *anything else / unmatched* | `/user` | USER LANDING (yellow box) |

**Why.** Finance staff do not want a dashboard of things they cannot act on. Each role
lands directly on its work queue. The unmatched default is a deliberate soft landing
rather than an error — it matches the `No Employee Type Matched` edge in the diagram.

**Where.** `src/app/login/page.tsx` (`routeMap`)

---

### 3.2 The root route is a hard redirect to `/login`
**Decision.** `/` does not render a dashboard; it redirects to `/login`.

**Why.** There is no meaningful anonymous view of a finance portal. Every entry point
funnels through the `Login Portal` node of `architecture.jpeg`.

**Where.** `src/app/page.tsx`

---

### 3.3 Per-page session guards rather than global middleware
**Decision.** Each protected page checks the session itself (`useSession` /
`getServerSession`) and redirects unauthenticated users, instead of one `middleware.ts`
matcher.

**Why.** The role checks are page-specific, not path-prefix-specific — `/user` is
reachable by everyone, `/audit` only by auditors. Colocating the guard with the page
keeps the rule next to the screen it protects.

**Trade-off.** The guard must be repeated per page and is easy to forget on a new route.
A middleware layer is the natural consolidation once the route set stops changing.

---

### 3.4 Navigation is filtered by role, not just the landing page
**Decision.** The shared sidebar computes its items from the user's `employee_type`.

**Why.** Defence in depth for usability: even if a user knows a URL, the UI never offers
a path into another role's queue. This mirrors the diagram, where each role's box
contains only that role's pages.

**Where.** `src/components/Sidebar.tsx`

---

## 4. Data Layer

### 4.1 Supabase (managed PostgreSQL) as the system of record
**Decision.** Supabase for all application data — `bills`, `employees`, `pda_balances`.

**Why.**
- Financial data needs real relational integrity: numeric money columns, foreign keys,
  and `CHECK` constraints on workflow state. Postgres gives all three.
- The managed offering removes DB operations from a small team's plate.
- `@supabase/supabase-js` provides typed queries and joins straight from React screens,
  which suits the table-heavy approval UIs.

**Where.** `src/lib/supabaseClient.ts`, `src/app/utils/supabase/*`, `data_base.sql`

---

### 4.2 Workflow state is enforced by database `CHECK` constraints
**Decision.** Legal values for the workflow columns are constrained in Postgres, not only
in TypeScript:

- `status ∈ {User, Student Purchase, Audit, Finance Admin, Accepted}`
- `snp`, `audit` ∈ `{Pending, Reject, Hold, Approved}`
- `finance_admin` ∈ `{Pending, Reject, Hold, Approved}` or `NULL`

**Why.** These five `status` values are literally the stages a bill moves through in the
blue `APPLY BILL WORKFLOW` region of `architecture.jpeg`. Encoding them in the schema
means no code path — including a future script or a manual SQL fix — can park a bill in
a state no screen knows how to render.

**Where.** `data_base.sql` (`public.bills`)

---

### 4.3 Four parallel status columns instead of one workflow state machine
**Decision.** A bill carries `status` (where it currently sits) *plus* independent
`snp`, `audit`, and `finance_admin` verdict columns, with a matching remark column each
(`remarks`, `remarks1`–`remarks4`).

**Why.** The approval chain is not a simple linear state machine — it is a set of
departmental sign-offs that must remain individually auditable after the fact. Once a
bill reaches `Accepted`, a reviewer still needs to see *what SNP said*, *what Audit
said*, and *what Finance Admin said*, each with its own Hold/Reject history. Collapsing
these into a single `status` would destroy that record.

**Trade-off.** Denormalised and numerically named (`remarks1`…`remarks4`), which is hard
to read. A normalised `bill_approvals` child table is the clean refactor; the flat shape
was chosen for query simplicity in the table UIs.

**Where.** `data_base.sql`, `src/types/database.ts`

---

### 4.4 `department` is a Postgres `ENUM`, not free text
**Decision.** A `public.department` enum lists every school, centre, and administrative
section at IIT Mandi.

**Why.** Departments key the PDA budget and the bill-routing check. Free-text entry
would produce "SCEE" / "School of Civil" / "civil" variants and silently break both.

**Where.** `data_base.sql` (`CREATE TYPE public.department`)

---

### 4.5 Employees are keyed by `employee_code`, not by surrogate `id`
**Decision.** Lookups and joins across the app use `employee_code` (the institute code,
which equals the LDAP `uid`).

**Why.** It is the only identifier shared by LDAP, the finance office's paperwork, and
the portal. Using it as the join key means a session's `uid` maps directly to an
employee and their PDA balance with no translation table. Recorded in the git history as
the commit *"employee-code not id"*.

**Trade-off.** Directory-code changes would require data migration; treated as
effectively immutable.

**Where.** `src/app/utils/services/employees.ts`, `src/app/api/supabase/index.ts`

---

### 4.6 A service layer wraps Supabase queries
**Decision.** Data access is grouped into `billsService`, `employeesService`, and
`pdaService` rather than inlining queries in components.

**Why.** The same query (bills for an employee, bills by status) is needed by the Audit,
SNP, Finance Admin, and User screens. One definition keeps their join shapes identical.

**Where.** `src/app/utils/services/{bills,employees,pda}.ts`

---

### 4.7 Split anon-key and service-role Supabase clients
**Decision.** Two clients — a browser client using `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
a server-only client using `SUPABASE_SERVICE_ROLE_KEY`.

**Why.** The service-role key bypasses row-level policies and must never reach the
browser bundle; the `NEXT_PUBLIC_` prefix boundary makes that split explicit and
enforceable by convention.

**Where.** `src/app/utils/supabase/client.ts`, `src/app/utils/supabase/server.ts`

---

## 5. The Bill Approval Workflow

This section corresponds to the blue **`APPLY BILL WORKFLOW`** region of
`architecture.jpeg`.

### 5.1 Routing is driven by two axes: item category and bill amount
**Decision.** A submitted bill's first destination is computed from `item_category`
(Major/Minor vs Consumables) and a **₹50,000** threshold — the `Route by Amount` diamond
in the diagram.

| Category | Amount | Path |
| --- | --- | --- |
| Major / Minor | any | → **SNP** first (Stores & Purchase verification) |
| Major / Minor | ≤ ₹50,000 | after SNP → **Finance Admin** |
| Major / Minor | > ₹50,000 | after SNP → **Audit** → **Finance Admin** |
| Consumables | ≤ ₹50,000 | → **Finance Admin** directly |
| Consumables | > ₹50,000 | → **Audit** → **Finance Admin** |

**Why.**
- Consumables are low-risk, high-volume purchases; sending them through Stores & Purchase
  would be pure queue latency for no control benefit.
- The ₹50,000 audit threshold reflects institute financial delegation: below it,
  Finance Admin's sign-off suffices; above it, an independent audit check is mandatory.

**Where.** `src/app/apply-bill/UploadBill.tsx`, `src/app/student-purchase/page.tsx`

---

### 5.2 The ₹50,000 bracket is immutable once a bill is filed
**Decision.** An edit to a bill may change its amount only *within* its original
bracket. A bill filed at ≤ ₹50,000 cannot be edited above the threshold, and vice versa.

**Why.** Otherwise a submitter could file at ₹49,000, clear the low-value path that skips
Audit, and then raise the amount — a straightforward control bypass. The rule closes
that hole at the point of edit rather than relying on downstream re-checks.

**Where.** `src/app/apply-bill/EditBillModal.tsx`

---

### 5.3 PDA balance is validated *and debited* at submission time
**Decision.** On submit, the portal (a) rejects the bill if the employee has no PDA
balance record, (b) rejects it if the balance is below the bill amount, and
(c) deducts the amount immediately on successful insert.

**Why.** Committing the funds at submission prevents the same balance from being pledged
against several in-flight bills simultaneously — the approval chain can take days.

**Trade-off — known gap.** The insert and the balance update are two separate calls, not
one transaction. A failure between them leaves a saved bill with an un-debited balance;
the code surfaces this as an explicit "contact admin" warning. Moving this into a
Postgres function/RPC is the correct fix.

**Where.** `src/app/apply-bill/UploadBill.tsx`

---

### 5.4 Three verdicts per stage — Approve, Reject, **Hold**
**Decision.** Every reviewing stage can Approve, Reject, or *Hold* a bill, and Hold and
Reject both require a remark.

**Why.** Real finance review is mostly neither approval nor rejection — it is "this is
missing a document". Hold keeps the bill alive and actionable by the submitter instead of
forcing a reject-and-refile cycle, and the mandatory remark makes the reason auditable.

**Where.** `src/app/audit/page.tsx`, `src/app/finance-admin/page.tsx`,
`src/app/student-purchase/page.tsx`

---

### 5.5 Every remark is stamped with its author and department
**Decision.** Remarks are written as `<department> — <remark>` with a timestamp, into
the stage-specific remark column.

**Why.** In a multi-department chain, an unattributed remark is worthless. This makes the
bill's own record self-describing, which is what an auditor opening it months later
needs.

---

### 5.6 Bank guarantee and delivery/installation details are captured at the SNP stage
**Decision.** Stores & Purchase records `has_bank_guarantee`, guarantee details and
amount, and the delivery/installation dates while approving — and these then display on
the Audit and Finance Admin screens.

**Why.** SNP is the stage physically handling the goods; it is the only stage that
*knows* these facts. Capturing them there, once, means the later stages review rather
than re-collect. Corresponds to the `Enter Bank Guarantee` and `Enter Installation
Dates` nodes in the diagram.

**Where.** `src/app/student-purchase/page.tsx`

---

### 5.7 Finance Admin holds the terminal approval
**Decision.** Only Finance Admin can move a bill to `status = 'Accepted'`. Every path in
the workflow — long or short — terminates there.

**Why.** A single accountable terminal authority is a hard requirement of the finance
process. SNP and Audit are advisory checks on the way.

**Where.** `src/app/finance-admin/page.tsx`

---

### 5.8 QR codes provide the paper-to-portal bridge
**Decision.** Approved bills render a QR code encoding
`{origin}/bill/{bill.id}`, printable from the Approved Bills screen. `/bill/[id]` is a
public, print-friendly full detail view.

This is the `QR Code Generation` terminal node in `architecture.jpeg`.

**Why.** Bills continue to exist as physical vouchers moving between offices. A QR
sticker on the paper lets anyone holding it pull up the authoritative digital record and
its full approval trail from a phone — the single highest-value integration between the
existing paper process and the portal.

**Trade-off.** `/bill/[id]` is currently unauthenticated so that a scan "just works".
Bill IDs are `gen_random_uuid()`, so the URLs are unguessable, but this is security by
obscurity and should become a signed/expiring link if bill contents are considered
sensitive.

**Where.** `src/app/apply-bill/ApprovedBills.tsx`, `src/app/bill/[id]/page.tsx`

---

### 5.9 Department consistency is checked at submission
**Decision.** A bill is rejected if the submitting page's department does not match the
applicant's department as recorded in `pda_balances`.

**Why.** Prevents one department's bill-filing clerk from drawing against another
department's PDA budget.

**Where.** `src/app/apply-bill/UploadBill.tsx`

---

## 6. Notifications

### 6.1 Email on every stage verdict, via a server-side API route
**Decision.** Any Hold / Reject / Approve triggers `sendBillRemarkNotification`, which
posts to `/api/send-email`; that route sends through Nodemailer over Gmail SMTP.

This is the `Notify User` node in the diagram.

**Why.**
- Staff do not poll a portal. Email is where institute communication already happens, so
  the notification has to travel to them.
- SMTP credentials live only in the server route — the browser never sees them.

**Trade-off.** Gmail SMTP with an app password is not a transactional email service: no
delivery tracking, no retry, and a daily send cap. Fine at the institute's bill volume;
a provider swap is the upgrade path if volume grows.

**Where.** `src/app/api/send-email/route.ts`, `src/helpers/emailService.ts`

---

### 6.2 Email content is a pure template function, separate from sending
**Decision.** `getBillUpdateEmailContent()` builds subject and HTML from typed data and
does nothing else; the API route handles transport.

**Why.** The template can be changed or tested without touching SMTP wiring.

**Where.** `src/helpers/mailer.ts`

---

### 6.3 Notifications carry the current verdict only, not the full remark history
**Decision.** `previousRemarks` is deliberately sent empty.

**Why.** Recipients need "what changed and what do I do now". The full history stays in
the portal, one click away, rather than making every email longer than it needs to be.

**Where.** `src/helpers/emailService.ts`

---

## 7. UI & Design System

### 7.1 Tailwind CSS 4 + shadcn/ui on Radix primitives
**Decision.** Tailwind v4 for styling; shadcn/ui ("new-york" style, neutral base) copying
Radix-based components into `src/components/ui/` rather than importing a component
library.

**Why.**
- Radix gives accessible dialogs, selects, and progress bars — non-trivial to get right,
  and needed by the approval modals.
- shadcn's copy-in model means components are owned and editable in-repo, with no version
  pinning or theme-override fights.

**Where.** `components.json`, `src/components/ui/*`

---

### 7.2 Mobile-responsive layout with an animated collapsible sidebar
**Decision.** Every screen is responsive; the sidebar collapses behind an overlay on
mobile, animated with `motion`.

**Why.** Approvals are frequently done away from a desk — a reviewer clearing a queue
from a phone is a normal case, not an edge case.

**Where.** `src/components/Sidebar.tsx`

---

### 7.3 Approval screens are client components with local optimistic state
**Decision.** Audit / SNP / Finance Admin screens are `"use client"` and update their
local bill array immediately after a successful mutation instead of refetching.

**Why.** Reviewers work through a queue in rapid succession; a full refetch per action
makes the screen feel broken. The write is confirmed before the local state changes, so
the optimism is bounded.

---

## 8. Deployment & Operations

### 8.1 Two supported deployment targets: Vercel and Docker
**Decision.** Ship both a `vercel.json` and a multi-stage `Dockerfile` +
`docker-compose.yml`.

**Why.** Vercel is the fastest path for previews and demos, but the portal talks to an
**internal LDAP server**. Production may well have to run on institute infrastructure,
inside the network perimeter. Supporting a container from day one keeps that option open
rather than requiring a migration later.

**Where.** `vercel.json`, `Dockerfile`, `docker-compose.yml`

---

### 8.2 `output: 'standalone'` for a minimal production image
**Decision.** Next.js emits a standalone server bundle; the Docker production stage
copies only `.next/standalone`, `.next/static`, and `public/` onto a bare
`node:20-alpine`.

**Why.** No `node_modules` in the final image — dramatically smaller, faster to pull, and
a smaller attack surface for an on-premise deployment.

**Where.** `next.config.ts`, `Dockerfile`

---

### 8.3 Vercel deployments pinned to the `bom1` (Mumbai) region
**Decision.** `regions: ["bom1"]`.

**Why.** Every user is in India, and the Supabase project and LDAP server are reached
from the function. Colocating removes a round-the-world hop from every request.

**Where.** `vercel.json`

---

### 8.4 The auth route is pinned to the Node.js runtime
**Decision.** `export const runtime = "nodejs"` on the NextAuth route.

**Why.** `ldapjs` needs raw TCP sockets and Node built-ins that an edge runtime does not
provide. This is a hard requirement, not a preference.

**Where.** `src/app/api/auth/[...nextauth]/route.ts`

---

### 8.5 All environment-specific configuration is externalised
**Decision.** LDAP URL, base DN, and OU list; Supabase URL and keys; SMTP credentials;
and `NEXTAUTH_SECRET` are all read from the environment, with sane defaults only for the
OU list.

**Why.** The same image must run against a staging directory and the production
directory. Nothing institute-specific or secret is committed.

**Where.** `src/app/api/auth/[...nextauth]/route.ts`, `docker-compose.yml`, `vercel.json`

---

### 8.6 The full database schema is committed as `data_base.sql`
**Decision.** A complete `pg_dump` of the schema lives in the repository.

**Why.** It is the reproducible way to stand up a fresh Supabase project, and it makes
the constraints in §4.2 and §4.4 reviewable in code review rather than hidden in a
dashboard.

**Trade-off.** A single snapshot is not a migration history; incremental schema changes
have no versioned path. Adopting Supabase migrations is the natural next step.

**Where.** `data_base.sql`

---

## 9. Known Debt — Decisions to Revisit

Recorded here so they are visible rather than discovered:

| # | Item | Section |
| --- | --- | --- |
| 1 | Hard-coded demo credentials bypassing LDAP — **remove before production** | §2.5 |
| 2 | `ignoreBuildErrors` / `ignoreDuringBuilds` left on | §1.3 |
| 3 | Bill insert + PDA debit are not one transaction | §5.3 |
| 4 | `/bill/[id]` is publicly readable by UUID | §5.8 |
| 5 | `remarks1`–`remarks4` should be a normalised `bill_approvals` table | §4.3 |
| 6 | No row-level security policies on the `public` tables | §4.1 |
| 7 | Per-page guards should consolidate into middleware | §3.3 |
| 8 | Unresolved merge-conflict markers remain in the auth route | §2.1 |
| 9 | `data_base.sql` snapshot should become versioned migrations | §8.6 |

---

## 10. The `revamp/backend-v2` Rebuild

Everything above §10 describes the prototype. This section records what
changed when the backend was rebuilt, and why. The screens were left as
they were on purpose — the problems were never in the markup.

Nine of the nine items in §9 are addressed here; the tenth, row-level
security, is still deliberately off (§10.11).

### 10.1 The workflow moved into the database

**Decision.** Every state change to a bill goes through one of four
PL/pgSQL functions: `fn_submit_bill`, `fn_bill_action`, `fn_amend_bill`,
`fn_set_pda_allocation`. Nothing in the browser writes to `bills`,
`pda_balances`, `bill_approvals` or `purchase_register` any more.

**Why.** The prototype filed a bill in two separate statements from the
browser: insert the bill, then debit the PDA. If the second failed, the
bill existed and had not been paid for, and nothing recorded the fact. The
same pattern appeared in four more places. Wrapping each of them in a
single database function makes the bill, the money, the event log and the
register impossible to disagree — they are written together or not at all.

**Trade-off.** Business rules now live in SQL, which is less familiar to
most contributors than TypeScript and harder to unit test. `routeAfter` in
`src/lib/roles.ts` mirrors `fn_route_after` so the UI can show a filer
where their bill is headed, and `tests/workflow.test.ts` pins that mirror
in place — but the database is the authority, and if the two drift the
database wins.

**Where.** `supabase/migrations/0002_functions.sql`

### 10.2 Closes §9.3 — the money is reserved, not spent

**Decision.** `pda_balances` gained three columns, holding one identity
enforced by a `CHECK` constraint:

```
allocated = balance + committed + spent
```

Money is **reserved** when a bill is filed, **released** when it is
rejected, and **settled** when it is finally approved.

**Why.** Two bugs, both about money. A rejected bill never gave the amount
back — the PDA stayed debited forever, and a manual "note this bill"
button existed to credit it by hand. And an in-flight bill was
indistinguishable from a paid one, so nobody could tell how much of a
depleted balance was actually gone.

**Trade-off.** Four columns to keep straight instead of one. The `CHECK`
constraint means a bug that breaks the identity fails loudly on the write
rather than quietly losing money, which is the point.

**Where.** `0001_schema.sql`, and `fn_submit_bill` / `fn_bill_action`

### 10.3 Rejection is terminal, in the database

**Decision.** `bills.status` gained `'Rejected'`. `fn_bill_action` refuses
to touch any bill in a terminal state.

**Why.** Rejection used to be a per-desk flag with no effect on the bill's
overall status, so a rejected bill sat in the queue looking live. Making it
a status the constraint knows about means "already rejected" is enforced
rather than remembered.

**Where.** `bills_status_check`, `fn_bill_action`

### 10.4 Closes §9.5 — `bill_approvals`, the workflow event log

**Decision.** A new append-only table records one row every time anything
happens to a bill: who, what, when, from which desk, with what remark,
and the status it moved from and to.

**Why.** `remarks1`–`remarks4` held one string per desk, overwritten each
time, with the actor's name and a timestamp glued on in the browser. There
was no way to answer "when did this reach Audit" or "who put it on hold in
March". The architecture diagram's QR code promises exactly that history.

`remarks1`–`remarks4` were **kept**, holding the latest remark per desk, so
that the existing pages keep rendering. They are now a denormalised
convenience written by the same function that writes the log, not the
record itself.

**Trade-off.** The same remark is stored twice. Deleting the old columns is
a UI change, and this branch deliberately did not make UI changes.

**Where.** `bill_approvals`, `fn_log_event`

### 10.5 `purchase_register` — the departmental register

**Decision.** A second append-only table: one row per finally approved
purchase, given a running serial number per department per financial year
(`SCEE/2026-27/0007`) at the moment of approval. Entries are cut by
`fn_bill_action`; there is no endpoint that writes one by hand.

**Why.** This is the register a finance office actually keeps — the thing
somebody quotes when asked where a purchase is logged. It did not exist.
The workflow ended at "Accepted" and nothing recorded the purchase as a
purchase.

**Trade-off.** One item per bill, so an invoice with five lines needs five
bills. Multi-line items were considered and deferred: they touch the bill
form and every page that displays a bill.

**Where.** `purchase_register`, `fn_next_register_serial`

### 10.6 Both ledgers refuse to be edited

**Decision.** `BEFORE UPDATE OR DELETE` triggers on `bill_approvals` and
`purchase_register` raise an exception.

**Why.** A register whose entries can be quietly changed is not a register.
This is enforced against the service-role key too, which is the only key
that ever reaches these tables.

**Trade-off.** The seed script has to lift the triggers to back-date its own
data, and puts them straight back. That is the only place it is allowed.

**Where.** `fn_block_mutation`

### 10.7 Closes §9.4 and §9.7 — authorisation on the server

**Decision.** Every page's data now comes from an API route under
`/api/*`. Each route resolves the caller from the session, reads their role
from `employees`, and scopes the query itself. A plain user gets their own
bills whatever the query string says. `/bill/[id]` requires a session and
checks ownership.

**Why.** The browser held the anon key and queried tables directly, then
filtered in React. That is not a filter — anybody with devtools open could
read every bill in the institute, and write to them. `/bill/[id]` was
readable by anyone who had a UUID.

**Trade-off.** Per-page guards were consolidated into shared helpers
(`requireActor`, `requireRole`, `requireApprover`) rather than middleware.
Middleware would centralise the redirects too, and remains worth doing.

**Where.** `src/server/session.ts`, `src/app/api/**`

### 10.8 One definition of a role

**Decision.** `src/lib/roles.ts` holds the eight roles, each one's landing
page, and a `normaliseRole` that understands every older spelling.

**Why.** Roles were spelled four ways across the login page, the sidebar,
the database constraint and the demo login list: `pda-manager` and
`pda manager`, `bill_employee_fill` and `Bill Employee`. `Finance Employee`
was in the constraint and the login route map, but `/finance-employee`
never existed — anyone holding it was redirected to a 404. It now
normalises to `User`.

**Trade-off.** An unrecognised role silently becomes `User` rather than
failing. Failing closed is the right default when the alternative is
granting access by accident.

**Where.** `src/lib/roles.ts`, `tests/workflow.test.ts`

### 10.9 The Dean of Finance assigns roles

**Decision.** A new `/admin` page and a `Dean` role. It lists everyone,
changes roles, adds people who have not signed in yet, deactivates people,
and opens or tops up PDA accounts. Finance Admin keeps the employee
directory it already had, but the API refuses a role change from anybody
but the Dean.

**Why.** The architecture diagram's "Check Employee Type" and "No Employee
Type Matched" branches assume somebody decides who is what. Nothing in the
portal did — roles were set by editing rows.

Deactivation is not deletion: bills, approvals and register entries all
name the person who filed or approved them.

**Where.** `src/app/admin/page.tsx`, `src/app/api/admin/**`

### 10.10 Closes §9.1 — demo logins, kept but gated

**Decision.** The fixed demo accounts remain, behind
`DEMO_LOGIN_ENABLED`. Each one now exists as a real row in `employees`, so
the role comes from the database like everybody else's.

**Why.** They are needed to demonstrate the portal away from the institute
network. What was wrong was not their existence but that nine of the
fifteen had no `employees` row at all, so they signed in and landed on
pages with no data and no explanation.

**Trade-off.** A single environment variable is all that separates the
demo deployment from an authenticated one. `DEMO_LOGIN_ENABLED=false` is
required for production, and is called out in `.env.example`.

**Where.** `src/server/auth-options.ts`

### 10.11 §9.6 stays open — row-level security is still off

Every read and write goes through an API route holding the service-role
key, and those routes check the caller's role first. The browser holds the
anon key and only reads.

That makes the API the only line of defence. RLS would be a second one, and
is the most valuable single thing left to add. It is not done here because
it is a substantial piece of work in its own right and this branch was
already changing how every page gets its data.

### 10.12 Closes §9.2 — type errors fail the build again

**Decision.** `ignoreBuildErrors` is off. `src/types/database.ts` was
rewritten to match the schema.

**Why.** The types file described a schema that no longer existed, so
Supabase resolved most tables to `never` and the pages worked around it
with `as any`. With the types correct, the casts came out and the build
type-checks clean.

`ignoreDuringBuilds` for ESLint is deliberately left on — lint warnings are
not worth failing a deployment over.

**Where.** `next.config.ts`, `src/types/database.ts`

### 10.13 Closes §9.8 and §9.9 — dead code and versioned migrations

Removed: `src/lib/auth.ts` (a dummy `testuser`/`password123` provider that
`/api/bills` was importing its `authOptions` from), `src/app/user1.tsx`,
`src/app/utils/services/*`, `src/app/api/supabse.ts`, `src/types/session.ts`
(a second, conflicting session type declaration), `src/helpers/emailService.ts`
and `src/helpers/mailer.ts`, and a 625-line commented-out earlier draft of
the PDA manager page.

`data_base.sql` is superseded by `supabase/migrations/`. It is left in place
as a record of the prototype's schema; `supabase/README.md` says not to run
it.

### 10.14 Notifications moved to the server

**Decision.** Mail is sent from the API route after the decision is already
committed, and never throws. `MAIL_REDIRECT_TO` diverts everything to one
inbox while demonstrating, printing the intended recipient at the top.

**Why.** It used to be sent from the browser, which meant the applicant's
email address and the send itself depended on a client that might have
navigated away. A mail failure must not be able to undo a recorded
approval — so it cannot.

**Where.** `src/server/notify.ts`

### 10.15 What the workflow is tested against

`scripts/test_workflow.sql` — 44 assertions against a real Postgres:
routing at the ₹50,000 boundary in both directions, reservation and
release, rejection being terminal, wrong-desk refusal, the append-only
triggers, the allocation guard, financial-year arithmetic, bill-number
uniqueness.

`tests/workflow.test.ts` — 20 assertions pinning the TypeScript mirror of
the routing rules and the role normalisation.

`supabase/seed/0003_demo_data.sql` generates its 151 bills by calling the
real functions rather than inserting rows, so the demo data is itself a
run of the workflow: the balances, the event log and the register are all
consequences rather than fabrications.

### 10.16 Known debt after this branch

| # | Item | Section |
| --- | --- | --- |
| 1 | No row-level security policies | §10.11 |
| 2 | Demo login bypass still present, behind an env flag | §10.10 |
| 3 | Page guards should consolidate into middleware | §10.7 |
| 4 | `remarks1`–`remarks4` duplicate `bill_approvals` | §10.4 |
| 5 | One item per bill; no multi-line invoices | §10.5 |
| 6 | No file upload — bills carry no scanned invoice | — |
| 7 | Serial number formats are placeholders | `fn_next_bill_number` |
| 8 | Four `window.confirm` prompts remain for destructive actions | — |
| 9 | No middleware; unauthenticated page loads redirect client-side | §10.7 |

---

## 11. Supabase Removed — Plain PostgreSQL

**Decision.** Drop Supabase entirely. The portal talks to any PostgreSQL
(13+) through `pg`, configured by a single `DATABASE_URL`.

**Why.** After §10 the portal used none of what Supabase adds. Auth is
LDAP + NextAuth, the browser never touches the database, row-level security
is off (§10.11), and every write already goes through a plain PL/pgSQL
function. What was left was the PostgREST query builder standing between
the API routes and SQL. It also carried the service-role key and anon key
around, and tied local development to a hosted project.

**What changed.**
- `src/server/db.ts` is a `pg` connection pool with `query` / `queryOne`
  helpers. It parses `numeric` and `bigint` as JS numbers and leaves `date`
  as a string, so API responses keep the shape they had under PostgREST.
- Every API route uses parameterised SQL. The workflow functions are called
  directly (`select public.fn_bill_action(...)`) and are unchanged.
- The admin lists get the PDA position (and the person's name) through a
  join instead of a second query. Adding an employee with an allocation now
  happens in one statement, so a failed PDA insert no longer leaves the
  person half-added.
- Search input is escaped for `ILIKE` instead of having `%,()` stripped out
  (those characters were only special in PostgREST's filter syntax).
- `supabase/` is now `db/`. `scripts/db-setup.sh` (`npm run db:setup`)
  creates and builds a database. `docker-compose.yml` has a `postgres:17`
  service that runs the same files on first start.
- Deleted: `@supabase/*` packages, the unused anon-key clients,
  `data_base.sql` and `supabase_bootstrap.sql` (Supabase dumps with `auth`,
  `storage` and `vault` schemas that do not load into plain Postgres), and
  `apply-all.sql` (which existed for pasting into the Supabase SQL editor).
- The Docker image no longer takes build args; nothing about the database
  is compiled into the browser bundle.

**Trade-off.** Backups, connection pooling and hosting are now ours to run.
`vercel.json` is still present, but a Vercel deployment needs a reachable
managed Postgres in `DATABASE_URL`. A database on `localhost` will not do.

**Where.** `src/server/db.ts`, `src/app/api/**`, `db/`, `scripts/db-setup.sh`,
`docker-compose.yml`
