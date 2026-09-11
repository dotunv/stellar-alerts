# Contributing to Stellar Alerts

Thank you for your interest in contributing to Stellar Alerts! We welcome contributions to help build a seamless, real-time alert and tracking system for freelancers and businesses on the Stellar network.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v20.0.0 or higher
- **npm**: v9.0.0 or higher
- **Docker**: For running local PostgreSQL 16 & Redis 7 services (`docker compose up -d`)

---

### 2. Installation & Workspace Setup

Clone the repository and install dependencies across all workspaces:

```bash
git clone https://github.com/stellar-alerts-labs/stellar-alerts.git
cd stellar-alerts
npm install
```

---

### 3. Environment Configuration

1. Copy `.env.example` to `apps/api/.env`:
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```
2. Update `apps/api/.env` with your local database URL and JWT secret:
   ```env
   DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/stellar_alerts?schema=public&connection_limit=20&pool_timeout=10"
   JWT_SECRET="your-super-secret-jwt-key"
   PORT="3001"
   REDIS_HOST="localhost"
   REDIS_PORT="6379"
   ```

3. Tune the database connection pool through `DATABASE_URL` query parameters:

   | Parameter | Default | Meaning |
   |---|---|---|
   | `connection_limit` | `20` | Maximum connections held open by the pool |
   | `pool_timeout` | `10` | Seconds a query waits for a free connection before failing |
   | `idle_timeout` | `30` | Seconds an unused connection is kept before being released |

   Set `DATABASE_REPLICA_URL` to send read-only queries (wallet and payment
   listings) to a PostgreSQL read replica. Without it those queries run against
   the primary.

---

### 4. Database Setup & Docker Stack

Start local database and Redis services using Docker Compose:

```bash
docker compose up -d
npm run db:push
```

To open Prisma Studio and inspect database records in your browser:

```bash
npm run db:studio
```

---

### 5. Running Tests & Typechecks

Run the automated Vitest test suite and TypeScript typechecks before opening a PR:

```bash
npm run test:api
npx tsc -p apps/api/tsconfig.json --noEmit
npx tsc -p apps/web/tsconfig.json --noEmit
```

---

### 6. Running the Development Application

Launch the full monorepo stack using Turborepo:

```bash
npx turbo dev
```

Or launch components individually from the project root:

| Command | Action |
|---|---|
| `npm run dev:api` | Starts the Fastify API server on http://localhost:3001 |
| `npm run dev:worker` | Starts the Stellar Horizon SSE Ingestion Worker process |
| `npm run dev:web` | Starts the Next.js Frontend Dashboard on http://localhost:3000 |

---

## 🛠️ Development Workflow & Guidelines

1. **Branch Naming**:
   - Features: `feat/feature-name`
   - Bugfixes: `fix/bug-description`
   - Documentation: `docs/topic-name`

2. **Commit Messages**:
   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat(api): add notification webhook service`
   - `fix(worker): handle network timeout on horizon query`
   - `docs: update setup guide in CONTRIBUTING.md`

3. **Testing with Stellar Testnet**:
   - Always test blockchain operations against **Stellar Testnet**.
   - Fund test public keys using [Stellar Friendbot](https://friendbot.stellar.org).
   - Never use real Stellar mainnet secret keys or funds during development!

---

## 🤝 Submitting Pull Requests

1. Push your feature branch to your fork or branch.
2. Create a Pull Request against `main`.
3. Fill out the included [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).
4. Maintainers will review and merge your PR once GitHub Actions CI status is green 🟢.

---

## 💬 Need Help? Join Community Chat

Have questions or want to discuss an issue before working on it? Join our Telegram maintainers & contributors chat:

👉 **[Join Stellar Alerts Telegram Group](https://t.me/+uElHrnWMb180MWM0)**

