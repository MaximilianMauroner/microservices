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

## Local stack

Start an owned local stack from the repository root. Install dependencies first.
Use Docker with Compose 2.24.4 or newer and the local Unix socket.

```bash
pnpm run local:stack /absolute/private/tools-local-run
```

Choose a private run directory outside the checkout. The command creates a
feedback encryption key there and retains it for restart. Reuse the same
directory to reuse its Compose project, database, object storage, key, and port
bindings. If a retained port is occupied, the command stops before it changes
the configuration or command logs. Stop that port's owner before you restart.
Do not delete the key while you retain encrypted Feedback responses.

The command resolves root `compose.yaml`, then creates a private port override.
Every published port uses an unused `127.0.0.1` port. PostgreSQL, MinIO, and the
Markdown administration mock run in Compose. Database setup and seed work use
the same project. Tools builds and runs on the host, so signed storage URLs use
the same loopback endpoint as the browser. The command never changes a signed
URL after signing. Do not export database or storage endpoints into this command.
It rejects inherited data endpoints.

After both `/live` and `/health` succeed, the command prints a redacted JSON
manifest with the Tools, storage, storage console, and administration origins.
The private run directory contains `manifest.json`, the generated override,
command logs, and the private host environment. Keep the private environment
and `identity.json` out of source control and shared evidence.

The command stops after 30 minutes. To use another bounded lifetime, supply
seconds as the second argument, up to 3600.

```bash
pnpm run local:stack /absolute/private/tools-local-run 3600
```

Press Ctrl+C to stop the owned host process and run Compose `down` for this
project. Cleanup retains its key and volumes. The `docker:up` and `docker:down`
scripts address the default project and do not manage this stack. If a command
crashes and leaves `active.lock`, check that its recorded process and stack are
stopped before you remove that lock. The command also retains the lock when
process release is uncertain or Compose cleanup fails. Retain the run directory
for recovery.
Volume deletion requires separate authorization.

The manifest reports acceptance limits separately. Signed multipart PUT,
preflight, and ETag exposure checks run over HTTP. MinIO allows the owned Tools
origin and the `null` origin used by sandboxed artifact downloads. Its global
CORS setting applies to all methods. This fixture cannot prove separate upload
and download origin policies for a production provider. Publisher browser journeys
remain blocked until a real browser confirms signed PUT and readable ETag.
Private browser acceptance requires a real local Google OAuth client and allowed
subject. The local placeholders do not prove login. Document Share requires a
separately owned disposable local Convex backend. The administration mock does
not implement the Convex browser protocol. Status heartbeat-to-publication
remains blocked until a bounded local checker has explicit local monitors,
the canonical fixture pause state, and notifications disabled. The setup does
not start a checker or default monitors.

The runtime helper `withLocalStack` in
`services/tools/test/runtime/local-stack.ts` exposes the same setup for future
journeys. Its caller supplies R1 owned command executors, an explicit private run
directory, and a bounded host lifetime. Its callback receives the manifest,
private environment, and cancellation signal. Cleanup runs when the callback
ends or the host process stops.

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
