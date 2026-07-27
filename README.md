# Tools Platform

Small hosted utilities and operational consoles live in `apps/*`. Shared pure
contracts belong in `packages/*`, short-lived jobs in `jobs/*`, and the uptime
monitor remains temporarily in `services/*` until its checker logic is ported.
Each component owns its runtime code, tests, configuration, deployment notes,
and README.

## Components

| Service | Path | Runtime | Purpose |
| --- | --- | --- | --- |
| Artifact publisher | `apps/artifact-publisher` | Railway | Sandboxed planning pages, temporary file uploads, resumable downloads, and revocation. |
| Field guide console | `apps/field-guide-console` | Railway | Review-only approval and lifecycle history for field-guide lessons. |
| Network console | `apps/network-console` | Local VM systemd service | Port-80 dashboard for Tailscale address and listening-port discovery. |
| Uptime monitor | `services/uptime-monitor` | Cloudflare Workers + D1 | Private HTTP(S) uptime dashboard with Discord incident alerts. |

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
bun run start:uptime-monitor
```

The root is a Bun workspace catalog, not a deployable service. Deployment
configuration belongs inside each component directory.

## Deployment Notes

Railway deploys the artifact publisher and field-guide console from
`apps/artifact-publisher` and `apps/field-guide-console`. Each owns a
`railway.json`, runs `bun run start`, and checks `/health`. Their stable public
domains and separate persistence and trust boundaries are unchanged.

If a host or deployment system starts from the repository root, use an explicit
root shortcut such as `bun run start:artifact-publisher` instead of treating the
workspace root as the service package.

The network console is not a Railway service. Install it on the VM with
`apps/network-console/ops/install-systemd.sh`; the `network-console.service`
unit is enabled for VM boot through `multi-user.target`.
