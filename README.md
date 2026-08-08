# Tools Platform

Runtime ownership is encoded in the top-level directory. Independently deployed
applications live in `apps/*`, reusable capabilities live in `packages/*`, and
background processes live in `jobs/*`. The TanStack application in
`apps/platform-service` owns every integrated route and its SPA navigation.

Public versus private access is intentionally independent of that layout. Both
platform routes and external applications may be public, Access-protected, or
private-network-only; the typed catalog records that access boundary.

## Components

| Service | Path | Runtime | Purpose |
| --- | --- | --- | --- |
| Platform service | `apps/platform-service` | Railway | Single HTTP process, checker scheduler, and Better Auth boundary for all hosted tools. |
| Artifact publisher | `packages/artifact-publisher` | Platform capability | Sandboxed planning pages, temporary file uploads, resumable downloads, and revocation. |
| Field guide console | `packages/field-guide-console` | Platform capability | Agent decision inbox plus review-only approval and lifecycle history for field-guide lessons. |
| Markdown Share | `apps/markdown-share` | Cloudflare | Independently hosted collaborative Markdown application. |
| Network console | `apps/network-console` | Local VM systemd service | Port-80 dashboard for Tailscale address and listening-port discovery. |
| Tools Web | `packages/tools-web` | Platform capability | Public tools directory and session-protected catalog operations. |
| Tools Checker | `jobs/tools-checker` | In-process module | One bounded status/incident/notification pass every five minutes. |
| Tools Domain | `packages/tools-domain` | Pure TypeScript | Shared schemas, safe projections, URL/IP validation, transitions, and bucket keys. |

## Commands

```bash
bun run typecheck
bun run test
bun run verify
```

## Local Docker stack

Run a local prod-mirroring stack (PostgreSQL, MinIO, Markdown mock, seed job,
platform service) with:

```bash
bun run docker:up
```

Then open:

- `http://localhost:3000` for the local platform service
- `http://localhost:9001` for MinIO console
- `http://localhost:8787` for the Markdown mock service

Stop the stack:

```bash
bun run docker:down
```

Reset local database and object storage state:

```bash
bun run docker:reset
```

The local stack uses non-production placeholder OAuth values so public routes
and infrastructure can start. Supply a real local Google OAuth client when
testing private browser routes.


Run an individual component's tests from its package directory. Only independently
running processes have standalone start shortcuts:

```bash
bun run start:network-console
bun run start:markdown-share
bun run start:tools-checker
```

The root deploys `apps/platform-service` using `/railway.json`. Embedded
capabilities are never deployed independently:
their browser routes fail with `503`; use the unified service for browser work.

## Deployment Notes

Railway deploys the workspace once:

| Service | Railway source root | Config path | Start command |
| --- | --- | --- | --- |
| Platform Service | `/` | `/railway.json` | `bun run --cwd apps/platform-service start` |

The platform service must remain awake because it owns the five-minute checker
scheduler. The redacted Tools home and `/status` surface are public. Publish,
Review, Manage, and private tools share one stateless Better Auth Google
session. Production requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`BETTER_AUTH_SECRET`, and `AUTH_ALLOWED_GOOGLE_SUBJECT`; the verified Google
subject must match before a session is issued. Artifact and file delivery uses
public, unlisted capability URLs, while the backing bucket remains private.
The native-token `/api/uploads*` and `/api/agent*` machine APIs remain on their
existing bearer credentials.

`/health` checks all dependencies. `/health/tools`, `/health/publisher`, and
`/health/review` expose public, component-specific readiness for the in-process
checker without borrowing another component's result.

Tools Web and Tools Checker share one private bucket with disjoint writer
ownership enforced in code. See [Tools Platform operations](docs/tools-platform/README.md)
for preview isolation, initial catalog bootstrap, cutover, rollback, recovery,
authentication incidents, cost controls, and legacy Worker retirement.

If a host or deployment system starts from the repository root, use an explicit
root shortcut such as `bun run start:artifact-publisher` instead of treating the
workspace root as the service package.

The network console is not a Railway service. Install it on the VM with
`apps/network-console/ops/install-systemd.sh`; the `network-console.service`
unit is enabled for VM boot through `multi-user.target`.

The legacy Cloudflare uptime Worker source was removed after the required
monitoring behavior was ported and audited. Its deployed Worker, route, Access
application, and D1 database are external resources and are not removed by this
repository change.
