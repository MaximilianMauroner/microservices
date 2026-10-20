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

The production-shaped local stack includes PostgreSQL, MinIO, a Markdown
administration mock, database setup, seed work, and Tools. Check that ports
3000, 5432, 9000, 9001, and 8787 are free before starting it.

The Markdown Share browser needs a Convex deployment. Run `pnpm run
start:markdown-share` in another terminal. Convex uses the selected development
deployment and writes its URL to `services/markdown-share/.env.local`. If that
URL is not `http://localhost:3210`, export `VITE_CONVEX_URL` with that URL before
the Compose command below. Docker passes it to both the browser build and the Tools
runtime. The administration mock stays on port 8787 and does not implement the
Convex browser protocol.

Tools requires `FEEDBACK_ENCRYPTION_KEY`, a base64url-encoded 32-byte key.
The checked-in Compose environment omits it. From the repository root, create
a private directory outside the checkout and pass the key through an explicit
override. This gives the stack its own Compose project and volumes:

```bash
set -eu
umask 077
LOCAL_STACK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/microservices-local.XXXXXX")
LOCAL_STACK_PROJECT=$(basename "$LOCAL_STACK_DIR" | tr '[:upper:].' '[:lower:]-')
node -e 'console.log("FEEDBACK_ENCRYPTION_KEY=" + require("node:crypto").randomBytes(32).toString("base64url"))' > "$LOCAL_STACK_DIR/.env"
cat > "$LOCAL_STACK_DIR/compose.override.yaml" <<'YAML'
services:
  platform:
    environment:
      FEEDBACK_ENCRYPTION_KEY: ${FEEDBACK_ENCRYPTION_KEY:?Set the owned local feedback key}
YAML
env -u FEEDBACK_ENCRYPTION_KEY docker compose -p "$LOCAL_STACK_PROJECT" --env-file "$LOCAL_STACK_DIR/.env" \
  -f compose.yaml -f "$LOCAL_STACK_DIR/compose.override.yaml" config --quiet
env -u FEEDBACK_ENCRYPTION_KEY docker compose -p "$LOCAL_STACK_PROJECT" --env-file "$LOCAL_STACK_DIR/.env" \
  -f compose.yaml -f "$LOCAL_STACK_DIR/compose.override.yaml" up --build
```

Keep the directory path, project name, and key for the lifetime of the test
responses. Reuse them when restarting the same stack. Do not put the generated
key in a checkout file or print the resolved configuration to logs. `env -u`
prevents an inherited shell key from overriding this project's private file. A new key
cannot decrypt responses in an existing volume. See
[Feedback setup](services/tools/feedback/README.md) for the encryption contract.

Then open:

- `http://localhost:3000` for Tools
- `http://localhost:9001` for the MinIO console
- `http://localhost:3000/share` for the integrated Markdown and LaTeX source frontend
- `http://localhost:8787` for the local Markdown administration mock

Stop this project from the same shell, or restore the saved directory path and
project name first:

```bash
env -u FEEDBACK_ENCRYPTION_KEY docker compose -p "$LOCAL_STACK_PROJECT" --env-file "$LOCAL_STACK_DIR/.env" \
  -f compose.yaml -f "$LOCAL_STACK_DIR/compose.override.yaml" down
```

This retains its database and object-storage volumes. Volume deletion requires
separate authorization. The `docker:up`/`docker:down` scripts use the default
project; they do not reuse this explicit environment and override.

The stack uses non-production OAuth placeholders so public routes and
infrastructure can start. Supply a local Google OAuth client to test private
browser routes.

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
