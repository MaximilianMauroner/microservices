# Microservices

Deployable services live under `services/`. Each service owns its application
code, configuration, tests, and deployment boundary. Tools is a single
TanStack Start monolith whose products live directly beneath `services/tools`.

## Services

| Service | Path | Runtime | Purpose |
| --- | --- | --- | --- |
| Tools | `services/tools` | Railway, Node.js | Authenticated product monolith and product-owned scheduled work. |
| Markdown Share backend | `services/markdown-share` | Convex | Document state, realtime collaboration, checkpoints, and retention. |
| Network Console | `services/network-console` | Local VM, Node.js | Private network and listening-port dashboard. |

Tools contains the `dashboard`, `status`, `publisher`, `field-guide`, `money`,
`feedback`, and Markdown Share browser products. Code reused within Tools remains owned by the product or
runtime module that provides it; there is no repository-wide shared package.

## Requirements

- Node.js 22.12 or newer
- pnpm 11.16.0 through Corepack

Install dependencies and verify the workspace:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run verify
```

Run an independently deployed service:

```bash
pnpm run start:tools
pnpm run start:markdown-share # Convex backend development
pnpm run start:network-console
```

Status scheduling runs inside Tools and is not a standalone deployment.

## Local stack

Start the production-shaped local stack, which includes PostgreSQL, MinIO, a
Markdown mock, database setup, seed work, and Tools:

```bash
pnpm run docker:up
```

Then open:

- `http://localhost:3000` for Tools
- `http://localhost:9001` for the MinIO console
- `http://localhost:3000/markdown` for the integrated Markdown Share frontend
- `http://localhost:8787` for the local Markdown administration mock

Stop the stack with `pnpm run docker:down`. To also delete its local database
and object-storage volumes, run `pnpm run docker:reset`.

The stack uses non-production OAuth placeholders so public routes and
infrastructure can start. Supply a local Google OAuth client to test private
browser routes.

## Railway

Railway builds the repository root with Railpack and starts Tools with:

```bash
pnpm --dir services/tools run start
```

The predeploy step applies the Tools migration and the Field Guide Postgres
schema. Status work runs in a dedicated Railway cron service, so Tools can sleep
between real traffic and scheduled probes. `/live` reports process liveness;
`/health` reports dependency readiness.

Production requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`BETTER_AUTH_SECRET`, and `AUTH_ALLOWED_GOOGLE_SUBJECT`. Machine APIs retain
their dedicated bearer credentials. Artifact bodies remain in private object
storage while canonical capability URLs serve authorized file access.

The Network Console is not a Railway service. Install it on its VM with
`services/network-console/ops/install-systemd.sh`.

See [Tools operations](docs/tools-platform/README.md) for deployment and
recovery procedures.
