#!/usr/bin/env python3
"""Rebuild the source-verified architecture atlas (Graphviz + reportlab + PyMuPDF).

Run from the repository root with Graphviz installed and a Python environment
containing reportlab, pymupdf, pillow and pypdf. No application data is accessed.
"""
from __future__ import annotations

import html
import json
import subprocess
import tempfile
import textwrap
import xml.etree.ElementTree as ET
from pathlib import Path

import pymupdf as fitz
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A2, landscape
from reportlab.pdfgen import canvas
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "architecture"
PDF_OUT = ROOT / "output" / "pdf" / "iit-mandi-architecture.pdf"
REVISION = "a96512e"
PALETTE = {
    "ui": ("#e5efff", "#1d4ed8"),
    "auth": ("#fff0d6", "#a16207"),
    "api": ("#eee9ff", "#6d28d9"),
    "db": ("#dff5e9", "#166534"),
    "hold": ("#fff5cc", "#92400e"),
    "error": ("#ffe5e5", "#b91c1c"),
    "external": ("#e4f5f8", "#0e7490"),
    "note": ("#f1f5f9", "#475569"),
}


class Diagram:
    def __init__(self, name, title, subtitle, sources, notes, direction="LR"):
        self.name, self.title, self.subtitle = name, title, subtitle
        self.sources, self.notes = sources, notes
        self.lines = [
            "digraph architecture {",
            f'graph [rankdir={direction}, bgcolor="transparent", fontname="Helvetica", '
            'fontsize=17, nodesep=0.34, ranksep=0.65, pad=0.25, splines=polyline, '
            'compound=true, newrank=true, outputorder=edgesfirst];',
            'node [shape=plain, fontname="Helvetica", fontsize=13];',
            'edge [fontname="Helvetica", fontsize=11, color="#64748b", '
            'fontcolor="#334155", arrowsize=0.7, penwidth=1.2];',
        ]

    def node(self, key, title, rows=(), kind="ui", width=46):
        fill, stroke = PALETTE[kind]
        body = []
        for row in rows:
            for part in textwrap.wrap(row, width=width, break_long_words=False, break_on_hyphens=False) or [""]:
                body.append(f'<TR><TD ALIGN="LEFT"><FONT COLOR="#1e293b" POINT-SIZE="13">{html.escape(part)}</FONT></TD></TR>')
        label = (f'<TABLE BORDER="1" COLOR="{stroke}" BGCOLOR="{fill}" CELLBORDER="0" '
                 'CELLSPACING="0" CELLPADDING="8">'
                 f'<TR><TD ALIGN="LEFT"><B><FONT COLOR="{stroke}" POINT-SIZE="16">{html.escape(title)}</FONT></B></TD></TR>'
                 + "".join(body) + "</TABLE>")
        self.lines.append(f"{key} [label=<{label}>];")
        return key

    def decision(self, key, label):
        self.lines.append(f'{key} [shape=diamond, style=filled, fillcolor="#fff0d6", color="#a16207", '
                          f'fontcolor="#713f12", margin=0.12, label={json.dumps(label)}];')
        return key

    def edge(self, left, right, label="", kind=None, dashed=False, constraint=True):
        attrs = [f"label={json.dumps(label)}"]
        if kind:
            attrs += [f'color="{PALETTE[kind][1]}"', f'fontcolor="{PALETTE[kind][1]}"']
        if dashed:
            attrs.append('style="dashed"')
        if not constraint:
            attrs.append("constraint=false")
        self.lines.append(f"{left} -> {right} [{', '.join(attrs)}];")

    def cluster(self, key, title, kind="note"):
        fill, stroke = PALETTE[kind]
        self.lines.append(f'subgraph cluster_{key} {{ label={json.dumps(title)}; style="rounded,filled"; '
                          f'color="{stroke}"; fillcolor="{fill}40"; fontcolor="{stroke}"; margin=18;')

    def close(self):
        self.lines.append("}")

    def same_rank(self, *keys):
        self.lines.append("{rank=same; " + "; ".join(keys) + ";}")

    def source(self):
        return "\n".join(self.lines + ["}"]) + "\n"


def build_diagrams():
    diagrams = []
    d = Diagram("01-complete-flow", "Complete website flow", "Identity -> role landing -> purchase workflow -> money, records and follow-up",
                ["src/lib/roles.ts", "src/app/page.tsx", "src/server/auth-options.ts", "src/app/api/bills/[id]/action/route.ts", "db/migrations/0002_functions.sql", "db/migrations/0004_integrity.sql"],
                ["Store & Purchase is displayed as SNP in the reference; its stored role/status is Student Purchase.",
                 "Hold is a desk sub-status, not a standalone bills.status. Correction resets the required route.",
                 "All non-User roles can read all bills through the API; departmental lists and write scope are separate.",
                 "QR links reopen an authenticated bill record, including records that are not yet accepted."])
    d.cluster("entry", "ENTRY / TRUSTED IDENTITY", "auth")
    d.node("browser", "Browser / login portal", ["React 19 + Next.js 15 App Router", "HTTPS via institute Nginx proxy", "/login -> NextAuth credentials"], "ui")
    d.node("login", "Identity verification", ["LDAP bind OR retained fixed demo accounts", "Database employee must exist and be active", "Role is read from employees, not the form", "JWT session: hard 8-hour lifetime"], "auth")
    d.decision("roles", "Live employee\nrole")
    d.edge("browser", "login"); d.edge("login", "roles"); d.close()
    d.cluster("landings", "ROLE LANDING PAGES", "ui")
    for key, title, rows in [
        ("user", "User /user", ["Own bills, progress and PDA balance"]),
        ("filer", "Bill Employee /apply-bill", ["Departmental filing, pending, accepted", "Rejected history + acknowledgement"]),
        ("editor", "Bill Editor /bill-editor", ["Departmental bills currently on hold"]),
        ("stores", "Store & Purchase /student-purchase", ["Store verification + bank guarantee"]),
        ("auditor", "Audit /audit", ["Review bills above Rs 50,000"]),
        ("finance", "Finance Admin /finance-admin", ["Final approval + employee directory"]),
        ("manager", "PDA Manager /pda-manager", ["Open, allocate, top up, close accounts"]),
        ("dean", "Dean /admin", ["Provision employees, roles, status, PDA"]),
    ]:
        d.node(key, title, rows, "ui"); d.edge("roles", key)
    d.close()
    d.cluster("purchase", "TRANSACTIONAL PURCHASE LIFECYCLE", "api")
    d.node("form", "Six-step bill wizard", ["Submitter -> PO/supplier -> invoice", "Items -> funding/stock -> review", "Delivered + installed when required"], "ui")
    d.node("submit", "Validated submission", ["POST /api/bills + retry UUID", "Authorised filer + active applicant/PDA", "Reserve free funds once; log submission"], "api")
    d.decision("category", "Category?")
    d.node("snp", "Store & Purchase", ["Major / Minor only", "Optional validated bank guarantee", "Delivery/installation facts read-only"], "api")
    d.decision("amount", "Amount >\nRs 50,000?")
    d.node("audit", "Audit verification", ["Required strictly above Rs 50,000"], "api")
    d.node("fin", "Finance approval", ["All routes end here", "Current revision + prior approvals", "Applicant/filer cannot decide own bill"], "api")
    d.node("accepted", "Accepted / settled", ["Committed -> spent", "One immutable purchase-register entry"], "db")
    d.node("held", "Hold / correction loop", ["Any active desk + mandatory reason", "Reservation stays; full form corrected", "Amount delta adjusts funds atomically", "Reset approvals/BG; restart category route"], "hold")
    d.node("rejected", "Rejected / terminal", ["Any active desk + mandatory reason", "Committed -> free balance, once", "Acknowledge without money movement", "Refile as a new bill if needed"], "error")
    d.edge("filer", "form", "file"); d.edge("form", "submit"); d.edge("submit", "category")
    d.edge("category", "snp", "Major / Minor"); d.edge("category", "amount", "Consumables")
    d.edge("snp", "amount", "Approved"); d.edge("amount", "audit", "Yes"); d.edge("amount", "fin", "No")
    d.edge("audit", "fin", "Approved"); d.edge("fin", "accepted", "Approved")
    for key in ["snp", "audit", "fin"]:
        d.edge(key, "held", "Hold", "hold", constraint=False)
        d.edge(key, "rejected", "Rejected", "error", constraint=False)
    d.edge("editor", "held", "correct"); d.edge("held", "category", "resubmit", "hold", constraint=False)
    d.edge("stores", "snp", "desk"); d.edge("auditor", "audit", "desk"); d.edge("finance", "fin", "desk")
    d.close()
    d.cluster("record", "RECORDS / READS / NOTIFICATIONS", "db")
    d.node("pda", "PDA accounts", ["allocated = free + committed + spent", "Management writes are role-restricted", "Closed accounts retained for history"], "db")
    d.node("ledgers", "PostgreSQL financial records", ["bills + complete form_data + revision", "bill_approvals: ordered immutable events", "change_log: immutable before/after", "purchase_register: final purchases"], "db")
    d.node("views", "Authenticated read views", ["/bills -> search/filter all permitted bills", "/register -> scoped totals + FY filters", "/bill/[id] -> items, timeline, revisions", "QR + print: no public data access"], "ui")
    d.node("mail", "Notify applicant after commit", ["Hold, rejection, final acceptance only", "Gmail/Nodemailer; optional demo redirect", "Failure does not undo the decision"], "external")
    d.edge("manager", "pda"); d.edge("dean", "pda"); d.edge("pda", "submit", "funds", dashed=True, constraint=False)
    d.edge("accepted", "ledgers"); d.edge("rejected", "ledgers"); d.edge("held", "ledgers", constraint=False)
    d.edge("ledgers", "views"); d.edge("views", "user", "own record", dashed=True, constraint=False)
    for key in ["accepted", "held", "rejected"]: d.edge(key, "mail", "outcome", dashed=True, constraint=False)
    d.close(); diagrams.append(d)

    d = Diagram("02-runtime", "Runtime and trust boundaries", "Self-hosted Docker: public HTTPS edge, private application and private database",
                ["Dockerfile", "docker-compose.yml", "deploy/nginx/portal.conf", "deploy/nginx/upgrade-map.conf", "next.config.ts", "src/server/db.ts", "src/app/layout.tsx"],
                ["This is the configured runtime, not evidence that the current commit has been deployed.",
                 "Only Nginx publishes a host port. PostgreSQL and Next.js stay on the private Compose network.",
                 "There is no separate microservice, message broker, Redis cache, object store or Supabase client.",
                 "Application health checks cover the login web tier; database readiness is a separate pg_isready check."])
    d.node("client", "User device / browser", ["React pages + NextAuth SessionProvider", "Same-origin JSON requests", "localStorage holds unsent form drafts", "No database credentials"], "ui")
    d.cluster("host", "INSTITUTE HOST / COMPOSE NETWORK", "note")
    d.node("proxy", "Nginx 1.27 / proxy", ["Host PORTAL_PORT (default 8116)", "TLS 1.2 / 1.3; HTTP/2", "Read-only institute certificate + key", "Forward Host / HTTPS / IP headers", "10 MB body limit; 60 s read timeout", "Buffering off; upgrade forwarding"], "external")
    d.cluster("app", "NEXT-APP CONTAINER - UNPRIVILEGED NODE USER", "api")
    d.node("next", "Node 22 / Next.js 15.5.25", ["React 19 + NextAuth v4", "Standalone server.js on private :3000", "Static bundles + client page shells", "Dynamic root and Node route handlers", "No published application port"], "ui")
    d.node("server", "Server-only application modules", ["auth-options / session / employee", "bill-validation / notify / http", "db: shared pg Pool, default max 10", "30 s idle connection timeout", "Parameterised SQL; transaction helpers"], "api")
    d.node("env", "Runtime server configuration", ["DATABASE_URL / POSTGRES_PASSWORD", "NEXTAUTH_URL / NEXTAUTH_SECRET", "LDAP_URL / LDAP_BASE_DN / OU", "DEMO_LOGIN_ENABLED / DEMO_PASSWORD", "EMAIL / EMAIL_PASSWORD / MAIL_ENABLED", "MAIL_REDIRECT_TO; no secrets in diagrams"], "auth")
    d.node("headers", "Response security policy", ["CSP self-only; frames/objects denied", "Production: no unsafe-eval", "Inline scripts/styles still allowed", "HSTS; nosniff; DENY framing", "Same-origin referrer; restricted sensors"], "auth")
    d.edge("next", "server"); d.edge("env", "server", "runtime", dashed=True); d.edge("headers", "next", "all responses", dashed=True)
    d.close()
    d.node("postgres", "PostgreSQL 17 / db", ["Private :5432; no host-published port", "Tables, constraints, locks and functions", "One transactional financial authority", "Health: pg_isready"], "db")
    d.node("volume", "Persistent pgdata volume", ["Financial state survives restarts", "Fresh volume: migrations 0001 -> 0004", "Existing volume: additive upgrade only"], "db")
    d.edge("client", "proxy", "HTTPS :8116"); d.edge("proxy", "next", "HTTP next-app:3000")
    d.edge("server", "postgres", "pg / SQL"); d.edge("postgres", "volume", "persistent data"); d.close()
    d.node("ldap", "Institute LDAP directory", ["OU bind over configured LDAP URL", "Reachability requires institute network", "No local employee password store"], "external")
    d.node("smtp", "Gmail SMTP via Nodemailer", ["Configured sender + app password", "Best-effort post-decision mail"], "external")
    d.node("backup", "Administrator / backups", ["Scheduled compressed SQL dump", "Custom-format pre-upgrade dump", "Protect + copy off host; test restores"], "note")
    d.edge("server", "ldap", "credentials", dashed=True); d.edge("server", "smtp", "notification", dashed=True)
    d.edge("postgres", "backup", "pg_dump", dashed=True); diagrams.append(d)

    d = Diagram("03-identity-access", "Authentication, session and role access", "Authentication proves identity; employees defines permissions on every authenticated request",
                ["src/server/auth-options.ts", "src/server/session.ts", "src/lib/roles.ts", "src/lib/security.ts", "src/app/login/page.tsx", "src/app/page.tsx", "src/app/api/admin/employees/[code]/route.ts"],
                ["Demo login remains intentionally available. Production needs explicit enablement and a non-empty password.",
                 "Every signed-in role can read its own /api/me. All non-User roles have global bill/register read capability.",
                 "The User UI currently displays bills/PDA; own submission/correction/acknowledgement are API capabilities, not a dedicated User wizard.",
                 "Page redirects improve navigation; live API and SQL guards are the actual authorisation boundary."])
    d.node("credentials", "/login credentials", ["Username trimmed; both fields required", "Identifier whitelist, length 1-100", "NextAuth credentials / CSRF flow"], "ui")
    d.decision("demo", "Enabled demo\nusername?")
    d.node("democheck", "Fixed demo password check", ["Dean, Finance Admin, Audit, SNP", "Bill-form, Bill-edit, pda manager, User", "E001-E008; exact fixed usernames", "Wrong demo password: reject, no fallback", "Development default 123; disable with false"], "auth")
    d.node("ldapbind", "LDAP bind for each OU", ["Default: students_ug, Faculty, Staff", "DN: uid=username,ou=OU,baseDN", "5 s timeout / connect timeout", "6 s fail-safe; unbind after result"], "external")
    d.node("employee", "Load canonical employee", ["Case-insensitive employee-code lookup", "Missing account: not provisioned", "Inactive account: deny sign-in", "Read role, department, name and email", "Database failures do not grant a fallback"], "db")
    d.node("jwt", "JWT session", ["Token + session maxAge 28,800 s", "signedInAt enforces hard 8 h expiry", "Refresh live employee on session access", "Inactive / DB failure invalidate token", "API currentActor rereads active employee"], "auth")
    d.node("navigate", "Safe navigation", ["/ root -> currentActor -> role home", "Allow only safe local callback paths", "Reject external/backslash/control URLs", "Sign-out -> /login"], "ui")
    d.node("denied", "Access denied", ["Bad credentials / absent / inactive", "Expired or unusable API session: 401", "Wrong permitted role/scope: 403"], "error")
    d.edge("credentials", "demo"); d.edge("demo", "democheck", "Yes"); d.edge("demo", "ldapbind", "No")
    d.edge("democheck", "employee", "correct"); d.edge("ldapbind", "employee", "bound")
    d.edge("employee", "jwt", "active + provisioned"); d.edge("jwt", "navigate")
    d.edge("employee", "denied", "otherwise", "error"); d.edge("jwt", "denied", "expired", "error", constraint=False)
    d.cluster("homes", "LANDINGS AND SERVER CAPABILITIES", "ui")
    for key, title, rows in [
        ("u", "User -> /user", ["Read own bills/register, lookup self", "API: submit / held edit / note own bill"]),
        ("b", "Bill Employee -> /apply-bill", ["File, held edit, note for own department", "Store & Purchase Section: umbrella scope"]),
        ("e", "Bill Editor -> /bill-editor", ["Held edit + rejected note API, scoped", "Cannot submit new bills"]),
        ("s", "Student Purchase -> /student-purchase", ["Only decide bills at Store & Purchase", "Read all bills; guarantee details on approve"]),
        ("a", "Audit -> /audit", ["Only decide bills currently at Audit", "Read all bills"]),
        ("f", "Finance Admin -> /finance-admin", ["Decide only at Finance Admin; PDA read", "Directory: create User, edit contacts", "Privileged role/active/department restricted"]),
        ("p", "PDA Manager -> /pda-manager", ["Open / allocate / top up / close PDA", "No bill filing or approval privilege"]),
        ("d", "Dean -> /admin", ["Directory, roles, active status, PDA", "Not a substitute bill approver/filer"]),
    ]:
        d.node(key, title, rows); d.edge("navigate", key)
    d.close(); diagrams.append(d)

    d = Diagram("04-submission", "Bill form and submission transaction", "The full form survives end-to-end; the server computes money and PostgreSQL reserves it once",
                ["src/app/apply-bill/UploadBill.tsx", "src/app/apply-bill/bill-form/model.ts", "src/app/apply-bill/bill-form/masters.ts", "src/server/bill-validation.ts", "src/app/api/bills/route.ts", "db/migrations/0003_stock_entry.sql", "db/migrations/0004_integrity.sql"],
                ["A bill has 1-100 structured item lines, retained in bills.form_data; flat columns are compatibility/display fields.",
                 "Client validation is guidance only. The API validates the form again and SQL independently checks money and workflow essentials.",
                 "Same actor + retry key + same payload returns the existing bill; a changed payload using that key is rejected.",
                 "Any failure rolls back the bill, reservation, counters and transactional audit/event writes together."], direction="TB")
    d.cluster("wizard", "BROWSER - SIX STEPS / UNSENT DRAFT", "ui")
    form_rows = [
        ("w1", "1  Submitter", ["Employee/enrolment code + canonical name", "Debounced lookup after 350 ms", "/api/lookup/employee?profile=only"]),
        ("w2", "2  PO and supplier", ["PO purchase or direct purchase", "PO number/date/value as applicable", "Supplier name + address; typed inputs"]),
        ("w3", "3  Bill / delivery", ["Invoice number/date; charges + remarks", "Delivered=yes + delivery date", "Installation required? done=yes + date"]),
        ("w4", "4  Items", ["Major / Minor / Consumables", "Group/type, make/model, description", "Qty, UOM, unit price, issued qty", "Custodian; building/floor/room per line"]),
        ("w5", "5  Funding and stock", ["Fund code OH-31 or OH-35", "System stock reference, not paper input", "Preview quantities and derived amount"]),
        ("w6", "6  Review", ["Full summary and two declarations", "Validate all six steps before sending", "Fingerprint -> crypto.randomUUID key"]),
    ]
    for key, title, rows in form_rows: d.node(key, title, rows, "ui", width=37)
    d.same_rank("w1", "w2", "w3")
    d.same_rank("w4", "w5", "w6")
    for left, right in zip(form_rows, form_rows[1:]): d.edge(left[0], right[0])
    d.node("draft", "Draft autosave", ["localStorage per signed-in ID", "Separate new-bill vs bill/revision key", "Clear draft after successful submission", "Not a server record / not a money reserve"], "note")
    d.edge("draft", "w1", "restore", dashed=True, constraint=False); d.close()
    d.cluster("api", "SERVER VALIDATION / AUTHORISATION", "api")
    d.node("post", "POST /api/bills", ["{form_data, submission_key}", "requireActor -> active live employee", "Validate shapes + caps (2,000 chars)", "Valid calendars; no future dates", "Delivered and installed if required"], "api")
    d.node("derive", "Validate + derive payload", ["Integer qty 1-999; issued 0..qty", "Recognised item types, UOM and funds", "Money finite, cents, total < Rs 10 billion", "Sum rounded qty x unit price + charges", "Invoice <= PO/direct purchase value", "Canonical active applicant + write scope"], "api")
    d.edge("w6", "post", "same-origin JSON"); d.edge("post", "derive"); d.close()
    d.same_rank("post", "derive")
    d.cluster("transaction", "POSTGRESQL - ONE FINANCIAL TRANSACTION", "db")
    for key, title, rows in [
        ("sqlguard", "fn_submit_bill guards", ["fn_assert_bill_writer + fn_validate_bill", "Set transaction-local app.actor_code", "Advisory lock: actor + submission UUID"]),
        ("retry", "Retry / invoice uniqueness", ["Existing key: compare stored MD5 hash", "Same details: return existing bill", "New key: unique non-rejected invoice", "Normalised supplier + invoice + invoice FY"]),
        ("funds", "Lock active PDA row", ["FOR UPDATE serialises submissions", "Applicant still active; sufficient free money", "Missing/closed/insufficient -> rollback"]),
        ("insert", "Internal settlement engine", ["Generate IITM/FY/00001 bill number", "Route from category + derived amount", "Insert bill: filer, form, invoice, revision=1", "Trigger assigns STK/FY/00001 reference"]),
        ("reserve", "Reserve and log", ["Free balance -= amount", "Committed += amount; spent unchanged", "Submitted + System Forwarded events", "Before/after bill and PDA change_log"]),
    ]: d.node(key, title, rows, "db")
    d.same_rank("sqlguard", "retry", "funds")
    d.same_rank("insert", "reserve")
    d.edge("derive", "sqlguard"); d.edge("sqlguard", "retry"); d.edge("retry", "funds", "new submission")
    d.edge("funds", "insert"); d.edge("insert", "reserve"); d.close()
    d.node("result", "201 bill response / confirmation", ["ID, number, amount, initial desk", "Refresh dashboard; clear unsent draft", "API error -> retain editable draft"], "ui")
    d.edge("reserve", "result", "commit"); d.edge("retry", "result", "same-key replay", dashed=True, constraint=False)
    diagrams.append(d)

    d = Diagram("05-approval-state", "Approval, hold, correction and rejection", "Database-authoritative state machine with revision checks and separation of duties",
                ["src/lib/roles.ts", "src/app/api/bills/[id]/action/route.ts", "src/app/api/bills/[id]/route.ts", "src/app/api/bills/[id]/note/route.ts", "db/migrations/0002_functions.sql", "db/migrations/0004_integrity.sql", "src/app/student-purchase/page.tsx"],
                ["Threshold is strictly greater than Rs 50,000. Exactly Rs 50,000 skips Audit.",
                 "Hold leaves bills.status at its current desk and sets that desk's sub-status to Hold; funds remain reserved.",
                 "A current desk may approve/reject an unchanged held bill; correction is not mandatory for every hold.",
                 "The immutable event trail survives correction. Active approval/BG fields reset and displayed progress uses events since the last correction."])
    d.node("review", "Reviewer request", ["POST /api/bills/{id}/action", "Approved / Rejected / Hold", "expected_revision always required", "Reject/Hold require a reason", "SNP extra: optional bank guarantee"], "ui")
    d.node("guards", "Lock bill + decision guards", ["Live active reviewer; owns current desk", "No accepted/rejected re-decision", "Revision exactly matches reviewed bill", "Neither applicant nor original filer", "Prior required desk approvals present", "Different desks use different reviewers", "Active PDA locked for safe settlement"], "auth")
    d.node("routing", "Routing after submit / correction", ["Major or Minor -> Store & Purchase", "Consumables -> amount-based route"], "api")
    d.node("snp", "Store & Purchase", ["Stored status: Student Purchase", "Bank guarantee: positive cents + details", "Delivery/installation facts cannot be changed", "Approved -> amount decision"], "api")
    d.decision("threshold", "Total >\nRs 50,000?")
    d.node("audit", "Audit", ["Review sanction/rates/details", "Approved -> Finance Admin"], "api")
    d.node("finance", "Finance Admin", ["Check all required prior approvals", "Approved -> terminal acceptance"], "api")
    d.node("accepted", "Accepted", ["finance_admin=Approved; decided_at", "pda_committed=false; pda_settled=true", "Move committed -> spent", "Unique immutable register row", "Approved + Registered events"], "db")
    d.edge("review", "guards"); d.edge("guards", "routing", "new/corrected route shown", dashed=True)
    d.edge("routing", "snp", "Major / Minor"); d.edge("routing", "threshold", "Consumables")
    d.edge("snp", "threshold", "Approved"); d.edge("threshold", "audit", "Yes"); d.edge("threshold", "finance", "No")
    d.edge("audit", "finance", "Approved"); d.edge("finance", "accepted", "Approved")
    d.cluster("hold", "NON-TERMINAL HOLD / CORRECTION LOOP", "hold")
    d.node("hold", "Hold at any current desk", ["Mandatory reason + event + revision++", "Desk stays the same; no money movement", "May be reviewed again without amendment"], "hold")
    d.node("amend", "PATCH /api/bills/{id}", ["Full form + expected_revision", "User-own / Bill Employee / Bill Editor", "Department scope; original applicant fixed", "Current hold required; active PDA locked", "Delta = new total - old total", "Free -= delta; committed += delta"], "hold")
    d.node("reset", "Invalidate and restart", ["Before/after bill snapshot retained", "Reset desk approvals + active remarks", "Clear bank guarantee fields", "Preserve original applicant + department", "Preserve bill number / stock / retry identity", "Compute route again; log resubmission"], "hold")
    d.edge("hold", "amend", "correction"); d.edge("amend", "reset"); d.edge("reset", "routing", "restart", "hold", constraint=False); d.close()
    d.cluster("reject", "TERMINAL REJECTION / ACKNOWLEDGEMENT", "error")
    d.node("reject", "Rejected at any current desk", ["Mandatory reason + decided_at", "Release committed -> free balance once", "No register entry; no amendment allowed", "Rejected + release events"], "error")
    d.node("note", "POST /api/bills/{id}/note", ["Same writer/edit scope; rejected only", "Set noted=true atomically, once", "Acknowledgement event; no money change", "Hide from unacknowledged filing history"], "api")
    d.node("refile", "Optional new submission", ["New bill identity and retry UUID", "Rejected invoice can be filed again", "All current validations apply"], "ui")
    d.edge("reject", "note"); d.edge("note", "refile", "if needed", dashed=True); d.close()
    for key in ["snp", "audit", "finance"]:
        d.edge(key, "hold", "Hold", "hold", constraint=False)
        d.edge(key, "reject", "Rejected", "error", constraint=False)
    d.edge("hold", "guards", "review current revision", dashed=True, constraint=False)
    d.node("after", "After committed outcome", ["Hold / reject / accept -> best-effort mail", "Read response -> reviewer UI refresh", "Validation/conflict -> no partial settlement"], "external")
    for key in ["accepted", "hold", "reject"]: d.edge(key, "after", "post-commit", dashed=True, constraint=False)
    diagrams.append(d)

    d = Diagram("06-pda-directory", "PDA money lifecycle and directory administration", "The conservation invariant is enforced in PostgreSQL, not by browser arithmetic",
                ["src/app/api/admin/pda/route.ts", "src/app/api/admin/employees/route.ts", "src/app/api/admin/employees/[code]/route.ts", "src/server/db.ts", "db/migrations/0001_schema.sql", "db/migrations/0004_integrity.sql"],
                ["allocated = balance + committed + spent; every component is non-negative and finite, stored as numeric(12,2).",
                 "Hold keeps money committed; acknowledgement does not return money because rejection already did.",
                 "Closing an account requires zero committed and zero spent and no open bills; free money can remain in the retained inactive row.",
                 "SQL functions/locks enforce financial writes. Reads are scoped by the server; RLS is not enabled."])
    d.cluster("wallet", "PDA MONEY STATES - AMOUNT A / CORRECTION DELTA D", "db")
    d.node("allocate", "Allocated funds", ["Open: allocation = free balance", "Set total >= committed + spent", "Top-up: allocation += positive amount", "Free = allocated - committed - spent"], "db")
    d.node("free", "balance / free", ["Available for the next purchase", "Cannot be used twice concurrently"], "db")
    d.node("committed", "committed / reserved", ["Submit: free -= A; committed += A", "Amend: free -= D; committed += D", "Hold: unchanged"], "hold")
    d.node("spent", "spent / settled", ["Accept: committed -= A; spent += A", "Free does not change at acceptance", "Register records the approved purchase"], "db")
    d.edge("allocate", "free"); d.edge("free", "committed", "submit A")
    d.edge("committed", "free", "reject: release A", "error", constraint=False); d.edge("committed", "spent", "final accept A"); d.close()
    d.cluster("pda", "PDA ADMINISTRATION", "api")
    d.node("read", "GET /api/admin/pda", ["Dean / PDA Manager / Finance Admin", "Active accounts + employee names", "q / department filters; read-only for Finance"], "api")
    d.node("write", "POST / PATCH / DELETE PDA", ["Dean or PDA Manager only", "POST: existing employee; open account", "Reopen only closed, uncommitted/unspent", "PATCH: set allocated OR positive top_up", "DELETE: close, never delete the row"], "api")
    d.node("pdalock", "Financial SQL / locks", ["fn_set_pda_allocation / fn_top_up_pda", "fn_close_pda; FOR UPDATE PDA lock", "No lost updates or close/submit race", "Money finite and at most two decimals", "change_log actor + before/after snapshots"], "db")
    d.edge("write", "pdalock"); d.edge("pdalock", "allocate", "atomic adjustment", constraint=False); d.close()
    d.cluster("directory", "EMPLOYEE DIRECTORY / ACCESS CONTROL", "auth")
    d.node("directory", "GET / POST employees", ["Dean + Finance Admin may read directory", "Dean provisions any canonical role", "Finance Admin creates plain User only", "Initial allocation on create: Dean only", "Employee + optional PDA in one statement"], "api")
    d.node("modify", "PATCH / DELETE employee code", ["Dean: role, contacts, department, active", "Finance: contacts; User access changes", "Finance cannot alter privileged role/status/dept", "Reject self-deactivation / own Dean removal", "DELETE means is_active=false"], "api")
    d.node("tx", "actorQueryOne transaction", ["BEGIN -> app.actor_code -> SQL -> COMMIT", "On failure: ROLLBACK on same connection", "Employee-authority advisory lock", "Last active Dean always retained", "Email/department sync to PDA", "Durable employee/PDA before/after log"], "db")
    d.node("revoked", "Next authenticated request", ["Active/role reread from employees", "Deactivated employee cannot sign in", "Existing submitted bills continue workflow", "Historical applicant department retained"], "auth")
    d.edge("directory", "tx"); d.edge("modify", "tx"); d.edge("tx", "revoked"); d.close()
    diagrams.append(d)

    d = Diagram("07-data-model", "Database model, constraints and audit records", "Eight public tables; structured item detail lives in JSONB, not a separate items table",
                ["db/migrations/0001_schema.sql", "db/migrations/0002_functions.sql", "db/migrations/0003_stock_entry.sql", "db/migrations/0004_integrity.sql", "src/types/database.ts", "src/server/db.ts"],
                ["Solid relationships labelled FK are enforced foreign keys; dashed relationships are logical/snapshot links only.",
                 "created_by, actor_code, recorded_by and change_log.entity_id are audit identities, not employee foreign keys.",
                 "Employee department columns use public.department enum; departments supplies active labels/codes rather than an FK link.",
                 "Append-only triggers block UPDATE/DELETE of ledgers; database owner/admin access must still be protected."])
    d.node("department", "departments", ["PK name: public.department enum", "code, is_active, sort_order", "Active lookup list + register serial prefix"], "db")
    d.node("employee", "employees", ["PK id UUID; UNIQUE employee_code", "UNIQUE upper(employee_code)", "employee_name, email, department", "employee_type, is_active", "created_at, updated_at", "Checks: 8 roles, trimmed IDs/names, email"], "db")
    d.node("pda", "pda_balances", ["PK id UUID; UNIQUE employee_id (FK)", "email, department, is_active", "allocated, balance, committed, spent", "numeric(12,2), updated_at", "Conserved + non-negative + finite checks"], "db")
    d.node("bill", "bills", ["PK id UUID; UNIQUE bill_number", "FK employee_id; employee snapshot name/dept", "created_by, revision, invoice_no/date", "form_data JSONB; submission_key/hash", "PO, supplier, items, quantities, fund, location", "stock_entry; delivery/installation dates", "has_bank_guarantee + amount/details", "status; snp/audit/finance_admin; noted", "remarks + per-desk remarks1..4", "pda_committed, pda_settled, decided_at", "created_at, updated_at"], "db")
    d.node("events", "bill_approvals  [APPEND-ONLY]", ["PK id UUID; FK bill_id", "UNIQUE (bill_id, seq)", "stage, action, actor_code/name/role", "remark, from_status, to_status", "amount, created_at", "Parent-bill lock serialises event seq"], "db")
    d.node("register", "purchase_register  [APPEND-ONLY]", ["PK id UUID; UNIQUE bill_id FK", "UNIQUE serial_no; financial_year", "bill_number, entry_date, recorded_at/by", "Department + employee snapshot", "Indenter, items, category, qty", "Supplier/address, amount, fund", "stock_entry, location"], "db")
    d.node("change", "change_log  [APPEND-ONLY]", ["PK id: generated bigint identity", "entity, entity_id, operation", "actor_code; old_data/new_data JSONB", "recorded_at", "Tracks bills, employees, pda_balances"], "db")
    d.node("counters", "counters", ["PK scope text; value integer", "Locked upsert, transactional increments", "bill:FY -> IITM/FY/00001", "reg:DEPT:FY -> DEPT/FY/0001", "Widths expand; FY/dates use IST"], "db")
    d.edge("employee", "pda", "1 -> 0..1 FK"); d.edge("employee", "bill", "1 -> many FK")
    d.edge("bill", "events", "1 -> many FK"); d.edge("bill", "register", "1 -> 0..1 FK")
    d.edge("department", "employee", "enum metadata", dashed=True); d.edge("department", "register", "code + snapshot", dashed=True)
    d.edge("counters", "bill", "bill number", dashed=True); d.edge("counters", "register", "serial", dashed=True)
    for key in ["bill", "employee", "pda"]: d.edge(key, "change", "trigger snapshot", dashed=True)
    d.node("json", "form_data JSONB / item structure", ["Requester; PO/direct; supplier/invoice", "Delivery/installation answers and dates", "Category, fund, charges, remarks", "declaration + totalConfirmed", "lines[]: key, group, type, brand, model", "description + descriptionEdited", "qty, uom, unitPrice, qtyIssued, custodian", "building, floor, room"], "note")
    d.node("constraints", "Integrity indexes / triggers", ["Unique actor + submission_key", "Unique normalised supplier/invoice/invoice FY", "Invoice index excludes Rejected / null legacy", "Revision++ on bill UPDATE; applicant fixed", "Stock ID assigned once and preserved", "Immutable logs; last-Dean guard", "New constraints NOT VALID preserve legacy", "Indexes: applicant, stage, dates, dept/FY"], "auth")
    d.edge("bill", "json", "contains", dashed=True); d.edge("bill", "constraints", "enforced", dashed=True)
    diagrams.append(d)

    d = Diagram("08-api-read-followup", "API surface, read flows, QR and notification", "All financial reads/writes are mediated by Next.js route handlers; no browser-to-database access",
                ["src/app/api", "src/lib/api.ts", "src/server/http.ts", "src/server/notify.ts", "src/app/bill/[id]/page.tsx", "src/app/register/page.tsx", "src/components/BillCard.tsx"],
                ["/api/departments has no session guard; it returns only active public department metadata.",
                 "Staff global read access is current policy, not a promise of departmental confidentiality.",
                 "Notification is awaited after the financial commit inside the request; it is not a durable queue or transactional outbox.",
                 "The purchase register has no write endpoint. Only final Finance approval creates an entry."])
    d.node("browser", "Client helper / pages", ["api.get/post/patch/del -> same-origin fetch", "JSON content type; GET cache:no-store", "Returns {data,error}; Notice displays errors", "api.bills follows 500-row cursor pages", "Failure on any page discards partial list"], "ui")
    d.node("guards", "Live server guards", ["requireActor / requireRole / requireApprover", "Active employee + database role", "Parameterised SQL; safe search literals", "Force-dynamic Node API routes"], "auth")
    d.edge("browser", "guards")
    d.cluster("read", "READ ENDPOINTS", "api")
    reads = [
        ("me", "GET /api/me", ["Any actor: own identity, home, active PDA"]),
        ("lookup", "GET /api/lookup/employee", ["User: self only; staff: any active employee", "code case-insensitive; profile=only omits PDA"]),
        ("bills", "GET /api/bills", ["User forced to own; non-User global read", "employee/stage/status/category/department/q", "limit/offset or timestamp|UUID cursor", "Stable created_at DESC, id DESC"]),
        ("detail", "GET /api/bills/{id}", ["User owns bill; staff may read all", "Bill + events + applicant + register + revisions", "Planned route computed for display"]),
        ("register", "GET /api/register", ["User forced own purchases; staff global read", "department/fy/from/to/q + limit/offset", "Rows/count/totals share exact WHERE", "All authorised FY choices + current IST FY"]),
        ("employees", "GET /api/admin/employees", ["Dean/Finance only: directory + active PDA", "q/role/department/active filters"]),
        ("pda", "GET /api/admin/pda", ["Dean/PDA Manager/Finance: active accounts"]),
    ]
    for key, title, rows in reads: d.node(key, title, rows, "api"); d.edge("guards", key)
    d.node("departments", "GET /api/departments", ["Unguarded active department name/code lookup"], "note")
    d.edge("browser", "departments", "metadata", dashed=True, constraint=False); d.close()
    d.node("writes", "WRITE ENDPOINTS -> SQL", ["POST /api/bills -> fn_submit_bill", "PATCH /api/bills/{id} -> fn_amend_bill", "POST /{id}/action -> fn_bill_action", "POST /{id}/note -> fn_note_bill", "POST employees; PATCH/DELETE /{code}", "POST/PATCH/DELETE PDA -> locked writes", "GET/POST /api/auth/[...nextauth] -> auth"], "db")
    d.edge("guards", "writes", "live permissions")
    d.cluster("detail", "DETAIL / PRINT / QR READ-BACK", "ui")
    d.node("page", "/bill/{id}", ["Structured items + current bill fields", "Desk route + events after correction", "Full timeline + before/after revision history", "Register details when finally approved", "Browser print; escaped BillCard print HTML"], "ui")
    d.node("qr", "QR link to current bill URL", ["react-qr-code generated in browser", "Not a payment QR or public token", "Scan -> same bill URL -> session check", "Sign-in callback returns to this record"], "ui")
    d.edge("detail", "page"); d.edge("page", "qr"); d.edge("qr", "guards", "reopen, authenticate", dashed=True, constraint=False); d.close()
    d.cluster("mail", "POST-COMMIT NOTIFICATION / OPTIONAL", "external")
    d.node("mailcheck", "Hold / Reject / final Accept", ["Read bill and applicant's current email", "MAIL_ENABLED false -> skip", "Missing mail credentials/email -> skip", "Intermediate approval: no email"], "external")
    d.node("smtp", "Nodemailer Gmail send", ["EMAIL + EMAIL_PASSWORD configuration", "MAIL_REDIRECT_TO can divert demo mail", "Escaped message fields + bill link", "Send errors logged, never rolled back"], "external")
    d.node("sent", "After successful SMTP send", ["Append System / Notified event", "fn_log_event parent lock -> next seq", "No automatic retry / outbox guarantee"], "db")
    d.edge("writes", "mailcheck", "action result committed", dashed=True); d.edge("mailcheck", "smtp", "configured")
    d.edge("smtp", "sent", "sent"); d.close()
    d.node("errors", "Error contract", ["401: missing/expired actor; 403: role/scope", "400: rule, malformed data or constraints", "404: bill record not found", "409: duplicate / stale reviewed revision", "503: missing schema; backup + upgrade", "500: generic failure; details server-only"], "error")
    d.edge("guards", "errors", "failure", dashed=True, constraint=False); diagrams.append(d)

    d = Diagram("09-operations", "Setup, deployment, verification and limits", "Safe upgrade path preserves existing balances, bills, approvals and register history",
                ["scripts/db-setup.sh", "scripts/db-upgrade.sh", "scripts/db-local.sh", "scripts/deploy-server.sh", "scripts/db-backup.sh", "db/seed/0003_demo_data.sql", "package.json", "README.md", "tests/db-integrity.test.ts"],
                ["The diagram documents commit a96512e on after-midsem, including migration 0004; live schema/deployment was not inspected.",
                 "87 tests, ESLint, TypeScript and production build passed for the implementation before this diagram was authored.",
                 "Migration 0004 preserves legacy rows; missing structured invoice/form fields need human completion on correction.",
                 "Do not delete volumes or run base schema migration 0001 over an existing application database."])
    d.node("code", "after-midsem source", ["Next/React application + SQL migrations", "package-lock pinned dependencies", "Lint + type errors block production build"], "ui")
    d.cluster("fresh", "FRESH DATABASE", "db")
    d.node("empty", "Administrator creates empty DB", ["npm run db:setup refuses any public table", "Apply 0001 schema + 0002 workflow", "0003 system stock + 0004 integrity"], "db")
    d.node("initial", "Initial access provisioning", ["Live: insert first Dean's LDAP employee ID", "Dean provisions users and workflow roles", "Dean/PDA Manager opens funded accounts"], "auth")
    d.node("demoseed", "Optional demo-only seed", ["Manual db/seed/0003_demo_data.sql", "Adds missing fixed demo accounts only", "New accounts get Rs 250,000 starter PDA", "Never truncates, resets or reactivates", "Not automatic on setup or Docker startup"], "hold")
    d.edge("empty", "initial"); d.edge("empty", "demoseed", "demo database only", dashed=True); d.close()
    d.cluster("upgrade", "EXISTING DATABASE - PRESERVE DATA", "db")
    d.node("backup", "Take and validate backup first", ["db-backup.sh: compressed SQL dump", "Daily cron is operator-configured", "Default retain last 30; copy off host", "Deploy script: pre-upgrade custom dump"], "db")
    d.node("upgrade", "Apply additive migrations", ["Local npm run db:upgrade -> 0004", "Deploy script applies 0003 then 0004", "0004 transaction + migration advisory lock", "Repeatable; retain original rows/history", "Ambiguous IDs halt for administrator review"], "db")
    d.node("deploy", "Build and start Docker services", ["Node 22 deps -> build -> standalone runtime", "Existing .env never overwritten", "Start DB, backup/upgrade, start app/proxy", "TLS host/cert/key + URL configured", "Restart retains pgdata volume"], "external")
    d.edge("code", "backup"); d.edge("backup", "upgrade"); d.edge("upgrade", "deploy"); d.close()
    d.node("checks", "Verification tools", ["npm run lint; tsc --noEmit", "npm test: unit + API boundaries", "npm run db:test: isolated temp cluster", "Legacy fixture before upgrade; concurrency", "npm run build: production bundle", "Real institute LDAP/SMTP acceptance pending"], "auth")
    d.edge("code", "empty", "new setup"); d.edge("code", "checks", "before deployment", dashed=True)
    d.node("limits", "IMPLEMENTATION LIMITS / NOT CONNECTED", ["No PO / supplier / building master service", "Fund choices currently OH-31 and OH-35", "No attachments / blob or object storage", "No payment gateway or bank settlement API", "No email outbox, durable queue or retries", "No database RLS; app guards read scope", "No public QR access / public register writes", "No Vercel deployment configuration", "Shared-password demo is a retained risk"], "note")
    d.edge("deploy", "limits", "operational context", dashed=True); diagrams.append(d)
    return diagrams


def wrapped(c, text, x, y, width, font="Helvetica", size=11, leading=15, color="#334155"):
    c.setFont(font, size); c.setFillColor(HexColor(color))
    words, line, lines = text.split(), "", []
    for word in words:
        candidate = (line + " " + word).strip()
        if c.stringWidth(candidate, font, size) > width and line:
            lines.append(line); line = word
        else:
            line = candidate
    if line: lines.append(line)
    for line in lines:
        c.drawString(x, y, line); y -= leading
    return y


def generate():
    diagrams = build_diagrams()
    OUT.mkdir(parents=True, exist_ok=True)
    PDF_OUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ifmp-architecture-render-") as temporary:
        temp = Path(temporary)
        rendered = []
        for d in diagrams:
            dot = OUT / f"{d.name}.dot"
            dot.write_text(d.source(), encoding="utf-8")
            for fmt, destination in [("svg", OUT / f"{d.name}.svg"), ("pdf", temp / f"{d.name}.pdf")]:
                subprocess.run(["dot", f"-T{fmt}", str(dot), "-o", str(destination)], check=True)
            doc = fitz.open(temp / f"{d.name}.pdf")
            rendered.append((d, doc))
        # A vector poster: overview at top, then paired detail panels.
        ns = "http://www.w3.org/2000/svg"
        ET.register_namespace("", ns)
        poster_width, margin, gutter = 6600, 100, 90
        usable, column = poster_width - 2 * margin, (poster_width - 2 * margin - gutter) / 2
        poster = ET.Element(f"{{{ns}}}svg", {"width": str(poster_width), "height": "1", "viewBox": "0 0 6600 1"})
        ET.SubElement(poster, f"{{{ns}}}title").text = "IIT Mandi finance portal - complete architectural flow and detailed atlas"
        ET.SubElement(poster, f"{{{ns}}}desc").text = "Nine source-verified diagrams covering the entire after-midsem website, commit a96512e."
        background = ET.SubElement(poster, f"{{{ns}}}rect", {"width": "6600", "height": "1", "fill": "#ffffff"})

        def label(text, x, y, size=34, fill="#0f172a", weight="400"):
            el = ET.SubElement(poster, f"{{{ns}}}text", {"x": str(x), "y": str(y), "font-family": "Helvetica,Arial,sans-serif", "font-size": str(size), "fill": fill, "font-weight": weight})
            el.text = text

        label("IIT MANDI  /  INTEGRATED FINANCE MANAGEMENT PORTAL", margin, 82, 54, weight="700")
        label("Complete architectural flow  |  after-midsem  |  source commit a96512e  |  12 October 2026", margin, 138, 31, "#475569")
        label("Implemented branch architecture. Demo login retained. Deployment and live database state not assumed.", margin, 187, 28, "#475569")
        y = 250

        def add_panel(d, x, top, panel_width, number):
            label(f"{number:02d}  {d.title}", x, top + 39, 36, weight="700")
            # Wrap panel subtitles at a safe character budget rather than squeezing type.
            subtitle_lines = textwrap.wrap(d.subtitle, width=125 if panel_width > 4000 else 82)
            for i, line in enumerate(subtitle_lines): label(line, x, top + 82 + i * 33, 26, "#475569")
            svg = ET.parse(OUT / f"{d.name}.svg").getroot()
            vb = [float(value) for value in svg.attrib["viewBox"].split()]
            scaled_height = panel_width * vb[3] / vb[2]
            scale = panel_width / vb[2]
            placement = ET.SubElement(poster, f"{{{ns}}}g", {
                "transform": f"translate({x},{top + 105 + len(subtitle_lines) * 33}) scale({scale})",
            })
            # Graphviz reuses node/edge IDs; namespace each panel's identifiers.
            for el in svg.iter():
                if "id" in el.attrib: el.attrib["id"] = f"{d.name}-{el.attrib['id']}"
            # Flatten nested SVG viewports; this renders consistently in both
            # browsers and PDF/image converters that ignore nested x/y offsets.
            for child in svg: placement.append(child)
            bottom = top + 125 + len(subtitle_lines) * 33 + scaled_height
            for line in textwrap.wrap(d.notes[0], width=160 if panel_width > 4000 else 90):
                label(line, x, bottom + 30, 23, "#475569"); bottom += 30
            return bottom + 50

        y = add_panel(diagrams[0], margin, y, usable, 1)
        for i in range(1, len(diagrams), 2):
            left_bottom = add_panel(diagrams[i], margin, y, column, i + 1)
            right_bottom = add_panel(diagrams[i + 1], margin + column + gutter, y, column, i + 2)
            y = max(left_bottom, right_bottom) + 80
        label("Solid arrows: request, control or enforced relationship. Dashed arrows: configuration, follow-up or logical relationship.", margin, y + 30, 27, "#475569")
        label("Blue UI  |  Amber identity/holds  |  Purple API/workflow  |  Green database/money  |  Red rejection/error  |  Cyan external", margin, y + 78, 27, "#475569")
        total_height = int(y + 150)
        poster.attrib.update({"height": str(total_height), "viewBox": f"0 0 6600 {total_height}"})
        background.attrib["height"] = str(total_height)
        ET.ElementTree(poster).write(OUT / "architecture-complete.svg", encoding="utf-8", xml_declaration=True)
        poster_image = fitz.open(OUT / "architecture-complete.svg")
        poster_image[0].get_pixmap(matrix=fitz.Matrix(0.8, 0.8), alpha=False).save(OUT / "architecture-complete.png")
        poster_image.close()

        # One printable, searchable, vector PDF page per diagram plus a source index.
        base_width, base_height = landscape(A2)
        shell = temp / "atlas-shell.pdf"
        c = canvas.Canvas(str(shell), pagesize=(base_width, base_height))
        c.setTitle("IIT Mandi finance portal - detailed architecture")
        c.setAuthor("Architecture atlas verified against after-midsem / a96512e")
        page_rects = []
        for index, (d, graph) in enumerate(rendered):
            # Vector fold-out pages retain natural diagram type size (>=11pt).
            # A fixed A4/A2 canvas would shrink long workflows into unreadable text.
            width = max(base_width, graph[0].rect.width + 70)
            height = max(base_height, graph[0].rect.height + 310)
            c.setPageSize((width, height))
            c.setFillColor(HexColor("#0f172a")); c.rect(0, height - 102, width, 102, fill=1, stroke=0)
            c.setFillColor(HexColor("#93c5fd")); c.setFont("Helvetica-Bold", 11)
            c.drawString(42, height - 30, "IIT MANDI / FINANCE PORTAL / ARCHITECTURE ATLAS")
            c.setFillColor(HexColor("#ffffff")); c.setFont("Helvetica-Bold", 25)
            c.drawString(42, height - 66, f"{index + 1:02d}  {d.title}")
            c.setFillColor(HexColor("#cbd5e1")); c.setFont("Helvetica", 11)
            c.drawString(42, height - 88, d.subtitle)
            footer_height = 155
            rect = fitz.Rect(35, 122, width - 35, height - footer_height - 20)
            page_rects.append(rect)
            rule_y = footer_height
            c.setStrokeColor(HexColor("#cbd5e1")); c.line(42, rule_y, width - 42, rule_y)
            y_note = rule_y - 23
            for note in d.notes:
                y_note = wrapped(c, "- " + note, 42, y_note, width - 84, size=11, leading=15)
            c.setFont("Helvetica", 9); c.setFillColor(HexColor("#64748b"))
            c.drawString(42, 22, f"after-midsem | source {REVISION} | 12 October 2026 | code-level architecture, not a live deployment audit")
            c.drawRightString(width - 42, 22, f"{index + 1} / {len(diagrams) + 1}")
            c.showPage()

        # Source index: exact repository paths, interpretation caveats and legend.
        width, height = base_width, base_height
        c.setPageSize((width, height))
        c.setFillColor(HexColor("#0f172a")); c.rect(0, height - 102, width, 102, fill=1, stroke=0)
        c.setFillColor(HexColor("#ffffff")); c.setFont("Helvetica-Bold", 25)
        c.drawString(42, height - 64, "10  Source index and reading guide")
        column_width = (width - 126) / 2
        for index, d in enumerate(diagrams):
            column_index = 0 if index < 5 else 1
            row_index = index if index < 5 else index - 5
            x = 42 + column_index * (column_width + 42)
            y_source = height - 145 - row_index * 185
            y_source = wrapped(c, f"{index + 1:02d}  {d.title}", x, y_source, column_width, font="Helvetica-Bold", size=14, leading=19, color="#1d4ed8") - 8
            for source in d.sources:
                y_source = wrapped(c, source, x, y_source, column_width, font="Courier", size=10, leading=14)
        x, y = 42 + column_width + 42, height - 145 - 4 * 185
        for note in [
            "READING GUIDE",
            "Solid arrow: primary flow / enforced FK when explicitly labelled. Dashed arrow: optional follow-up, configuration or logical link.",
            "Blue: browser/page. Amber: identity/hold. Purple: API/workflow. Green: database/money. Red: failure/rejection. Cyan: external dependency.",
            "Labels describe implementation at source commit a96512e. Diagram generation does not change application behavior or deploy migration 0004.",
            "No real credentials, applicant records or production data are included. Original architecture.jpeg is preserved.",
        ]:
            y = wrapped(c, note, x, y, column_width, font="Helvetica-Bold" if note == "READING GUIDE" else "Helvetica", size=11, leading=15) - 12
        c.setFont("Helvetica", 9); c.setFillColor(HexColor("#64748b"))
        c.drawString(42, 22, f"after-midsem | source {REVISION} | editable Graphviz sources and generator in docs/architecture")
        c.drawRightString(width - 42, 22, "10 / 10"); c.showPage(); c.save()
        atlas = fitz.open(shell)
        for index, (_, graph) in enumerate(rendered): atlas[index].show_pdf_page(page_rects[index], graph, 0)
        atlas.set_toc([[1, f"{i+1:02d} {d.title}", i+1] for i, d in enumerate(diagrams)] + [[1, "10 Source index", 10]])
        atlas.save(PDF_OUT, garbage=4, deflate=True)
        atlas.close()

        # Render the latest PDF for visual QA; final PNG comes from its vector overview.
        final = fitz.open(PDF_OUT)
        qa = ROOT / "tmp" / "pdfs" / "architecture"
        qa.mkdir(parents=True, exist_ok=True)
        thumbs = []
        for index, page in enumerate(final):
            pix = page.get_pixmap(matrix=fitz.Matrix(0.9, 0.9), alpha=False)
            image_path = qa / f"page-{index + 1:02d}.png"
            pix.save(image_path)
            image = Image.open(image_path).convert("RGB")
            image.thumbnail((820, 600)); thumbs.append(image)
        contact = Image.new("RGB", (1680, 620 * 5), "#e2e8f0")
        draw = ImageDraw.Draw(contact)
        for index, thumb in enumerate(thumbs):
            x, y = 20 + (index % 2) * 840, 24 + (index // 2) * 620
            draw.text((x, y - 17), f"Page {index + 1:02d}", fill="#0f172a")
            contact.paste(thumb, (x, y))
        contact.save(qa / "contact-sheet.png")
        overview = rendered[0][1][0]
        overview.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(OUT / "architecture-overview.png")
        final.close()
        for _, graph in rendered: graph.close()

    reader = PdfReader(PDF_OUT)
    assert len(reader.pages) == 10
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    for required in ["Demo", "50,000", "form_data", "fn_amend_bill", "allocated", "purchase_register", "Notified", "after-midsem", "Eight public tables"]:
        assert required in text, f"Missing expected architecture content: {required}"
    print(f"Created {len(diagrams)} editable diagrams, one complete vector poster, an overview PNG and a 10-page PDF.")
    print(f"PDF: {PDF_OUT}")
    print(f"Poster: {OUT / 'architecture-complete.svg'}")
    print(f"QA: {ROOT / 'tmp' / 'pdfs' / 'architecture' / 'contact-sheet.png'}")


if __name__ == "__main__":
    generate()
