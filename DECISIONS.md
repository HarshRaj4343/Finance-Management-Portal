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
