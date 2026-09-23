## Integrated Finance Management Portal for IIT Mandi

An **integrated, role-based finance management portal** for IIT Mandi built with **Next.js 15**, **React 19**, **PostgreSQL**, and **NextAuth.js**.  
It streamlines workflows such as bill application and approval, auditing, student purchases, and finance administration in a single web interface.

---

## 🏗️ System Architecture

![System Architecture](./architecture.jpeg)

This architecture shows how the frontend, backend, authentication, and database layers interact to handle secure financial workflows and role-based operations.

---

## Features

- **Authentication & Security**
  - **NextAuth.js** authentication
  - **PostgreSQL** as the data layer, accessed only from server-side API routes
  - **Role-based access control** (students, PDA managers, finance admins, auditors, etc.)

- **Finance & Bills**
  - **Apply Bill** flow with upload and history tracking
  - **Bill editor** and **bill details** view
  - **Bills dashboard** for quick overview and status
  - **Audit workflows** for reviewing and validating bills

- **Modules**
  - **Finance admin** panel
  - **PDA manager** interface
  - **Student purchase** management
  - **User management** pages

- **UX & UI**
  - Modern UI built with **Radix UI** primitives and utility components
  - **Responsive layout** optimized for desktop and mobile

---

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **UI / Styling**:
  - Tailwind CSS 4
  - Radix UI components
  - Custom reusable UI primitives
- **Auth & Data**:
  - PostgreSQL (via `pg`)
  - NextAuth.js
- **Email & Utilities**:
  - Nodemailer
  - LDAP integration

---

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- npm
- PostgreSQL 13 or newer (e.g. `brew install postgresql@17 && brew services start postgresql@17`)

### Installation

```bash
git clone <your-repo-url>
cd integrated-finance-management-portal-for-iit-mandi
npm install
cp .env.example .env        # then fill in DATABASE_URL, NEXTAUTH_SECRET, ...
npm run db:setup            # creates the database, applies db/migrations, loads demo data
npm run dev

---

## Deploying on the institute server

Three containers on one private network: nginx terminates TLS on the
allocated port, the app and the database are not reachable from outside.

```
browser --https:8116--> proxy (nginx) --http--> next-app --> db
                         published            internal     internal
```

On the server:

```bash
git clone <this repo> && cd integrated-finance-management-portal-for-iit-mandi
cp .env.example .env && chmod 600 .env     # then fill it in -- see below
docker compose up -d
```

`.env` must contain, at a minimum:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | exactly how people reach it, e.g. `https://172.22.100.12:8116` |
| `SSL_CERT_FILE` | host path to the certificate, e.g. `/home/<user>/portal.crt` |
| `SSL_KEY_FILE` | host path to the private key |

Compose refuses to start if any of those four are missing, rather than
coming up without TLS or with a guessable database password.

The port is set in one place, `docker-compose.yml` (`proxy.ports` and
`listen` in `deploy/nginx/portal.conf`). Changing the allocated port means
changing both, and `NEXTAUTH_URL`.

**Data.** The database lives in the named volume `pgdata`, which survives
`docker compose down`, restarts and image rebuilds. Only `docker compose
down -v` destroys it. Back it up with `scripts/db-backup.sh`, from cron:

```
0 2 * * *  cd /srv/ifmp && ./scripts/db-backup.sh >> /var/log/ifmp-backup.log 2>&1
```

**Checking it.** `docker compose ps` should show all three healthy. If the
portal does not answer, `docker compose logs proxy` and
`docker compose logs next-app` say why; a TCP connection that is accepted
and then immediately closed means the app behind the proxy is not running.
