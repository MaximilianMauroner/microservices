# Tools Platform

Small hosted utilities and operational consoles live in `apps/*`. Their runtime
modules are mounted by one production service so compute and authentication
share a single boundary. Shared pure contracts belong in `packages/*`.

## Components

| Service | Path | Runtime | Purpose |
| --- | --- | --- | --- |
| Platform service | `apps/platform-service` | Railway | Single HTTP process, checker scheduler, and Cloudflare Access boundary for all hosted tools. |
| Artifact publisher | `apps/artifact-publisher` | Railway | Sandboxed planning pages, temporary file uploads, resumable downloads, and revocation. |
| Field guide console | `apps/field-guide-console` | Railway | Review-only approval and lifecycle history for field-guide lessons. |
| Network console | `apps/network-console` | Local VM systemd service | Port-80 dashboard for Tailscale address and listening-port discovery. |
| Tools Web | `apps/tools-web` | In-process module | Public tools directory and Cloudflare Access-protected catalog operations. |
| Tools Checker | `jobs/tools-checker` | In-process module | One bounded status/incident/notification pass every five minutes. |
| Tools Domain | `packages/tools-domain` | Pure TypeScript | Shared schemas, safe projections, URL/IP validation, transitions, and bucket keys. |

## Commands

```bash
bun run typecheck
bun run test
bun run verify
```

Run an individual component's tests from its package directory. The following
standalone shortcuts are retained for machine-API and focused development work:

```bash
bun run start:artifact-publisher
bun run start:field-guide-console
bun run start:network-console
bun run start:tools-web
bun run start:tools-checker
```

The root deploys `apps/platform-service` using `/railway.json`. Standalone
Publisher and Field Guide processes do not provide browser authentication:
their browser routes fail with `503`; use the unified service for browser work.

## Deployment Notes

Railway deploys the workspace once:

| Service | Railway source root | Config path | Start command |
| --- | --- | --- | --- |
| Platform Service | `/` | `/railway.json` | `bun run --cwd apps/platform-service start` |

The platform service must remain awake because it owns the five-minute checker
scheduler. The redacted Tools home and `/status` surface are public;
Cloudflare Access protects Publisher upload/list/revoke surfaces, Review,
Manage, and their protected legacy browser aliases. Artifact and file delivery
uses public, unlisted capability URLs: possession of an unguessable URL grants
read access, while the backing bucket remains private. The application also
verifies the Access assertion before dispatching any protected route.

Production requires three distinct Access audiences:
`CF_ACCESS_MANAGE_AUDIENCE`, `CF_ACCESS_PUBLISHER_AUDIENCE`, and
`CF_ACCESS_REVIEW_AUDIENCE`. Publisher covers `/publish`, `/uploads`, and
`/api/external-uploads`; non-read requests to delivery paths also fail closed
behind that audience. Unauthenticated `GET`/`HEAD` requests may read
`/artifacts*`, `/files*`, `/p*`, and `/f*`. The native-token `/api/uploads*`
and `/api/agent*` machine APIs bypass browser Access but remain protected by
their upload and agent bearer tokens.

`/health` checks all dependencies. `/health/tools`, `/health/publisher`, and
`/health/review` expose public, component-specific readiness for the in-process
checker without borrowing another component's result.

Tools Web and Tools Checker share one private bucket with disjoint writer
ownership enforced in code. See [Tools Platform operations](docs/tools-platform/README.md)
for preview isolation, initial catalog bootstrap, cutover, rollback, recovery,
Access incidents, cost controls, and Cloudflare Worker retirement.

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
