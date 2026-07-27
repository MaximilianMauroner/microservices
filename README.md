# Tools Platform

Small hosted utilities and operational consoles live in `apps/*`. Shared pure
contracts belong in `packages/*`, and short-lived jobs in `jobs/*`.
Each component owns its runtime code, tests, configuration, deployment notes,
and README.

## Components

| Service | Path | Runtime | Purpose |
| --- | --- | --- | --- |
| Artifact publisher | `apps/artifact-publisher` | Railway | Sandboxed planning pages, temporary file uploads, resumable downloads, and revocation. |
| Field guide console | `apps/field-guide-console` | Railway | Review-only approval and lifecycle history for field-guide lessons. |
| Network console | `apps/network-console` | Local VM systemd service | Port-80 dashboard for Tailscale address and listening-port discovery. |
| Tools Web | `apps/tools-web` | Railway Serverless | Public tools directory and Cloudflare Access-protected catalog operations. Sleeps between requests. |
| Tools Checker | `jobs/tools-checker` | Railway cron | One bounded status/incident/notification pass every five minutes, then exits. |
| Tools Domain | `packages/tools-domain` | Pure TypeScript | Shared schemas, safe projections, URL/IP validation, transitions, and bucket keys. |

## Commands

```bash
bun run typecheck
bun run test
bun run verify
```

Run an individual component from its package directory, or use the root shortcuts:

```bash
bun run start:artifact-publisher
bun run start:field-guide-console
bun run start:network-console
bun run start:tools-web
bun run start:tools-checker
```

The root is a Bun workspace catalog, not a deployable service. Deployment
configuration belongs inside each component directory.

## Deployment Notes

Railway deploys the artifact publisher, field-guide console, Tools Web, and
Tools Checker from their component directories. Each owns its `railway.json`.
Tools Web must have Railway Serverless enabled and contains no background work.
Tools Checker is a `*/5 * * * *` cron with no listener or restart loop.

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
