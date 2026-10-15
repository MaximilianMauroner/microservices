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

Tools contains the `dashboard`, `status`, `publisher`, `money`, `feedback`, and
Markdown Share browser products. Code reused within Tools remains owned by the product or
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

Status probes run in the dedicated bounded cron process defined in
`services/tools/status/railway.json`. Other Tools scheduled work retains its
product ownership.

## Local verification

Use the [Tools verification skill](.agents/skills/verify-tools/SKILL.md) for an
owned loopback application with native PostgreSQL and S3. The helper creates a
new disposable database and private buckets. It supplies local credentials and
retains fixture data when you stop it. Do not use Docker or point a local
process at production data.

Use the [Network Console verification skill](.agents/skills/verify-network-console/SKILL.md)
for its separate loopback process. Both skills require a listener and process
ownership check before launch.

Private browser journeys require an authorized local Google OAuth client and
subject. Placeholder OAuth values can start public routes and native upload
checks. They cannot prove authenticated browser journeys.

## Railway

Railway builds the repository root with Railpack and starts Tools with:

```bash
pnpm --dir services/tools run start
```

The predeploy step applies the Tools PostgreSQL schemas. Status work runs in a dedicated Railway cron service, so Tools can sleep
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
