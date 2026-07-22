# Microservices

Local and deployed microservices live in `services/*`. Each service owns its runtime code, tests, config, deployment notes, and service-specific README.

## Services

| Service | Path | Runtime | Purpose |
| --- | --- | --- | --- |
| HTML publisher | `services/html-publisher` | Railway | Sandboxed planning pages, temporary file uploads, resumable downloads, and revocation. |
| Tailscale port dashboard | `services/tailscale-port-dashboard` | Local VM systemd service | Port-80 dashboard for Tailscale address and listening-port discovery. |
| Uptime monitor | `services/uptime-monitor` | Cloudflare Workers + D1 | Private HTTP(S) uptime dashboard with Discord incident alerts. |

## Commands

```bash
bun run typecheck
bun run test
bun run verify
```

Run an individual service from its package directory, or use the root shortcuts:

```bash
bun run start:html-publisher
bun run start:tailscale-port-dashboard
bun run start:uptime-monitor
```

The root is a Bun workspace catalog, not a deployable service. Service deployment config belongs inside each service directory.

## Deployment Notes

Railway deploys only the HTML publisher from `services/html-publisher` as the service root. Its `railway.json` expects that working directory, runs `bun run start`, and checks `/health`.

If a host or deployment system starts from the repo root, use an explicit root shortcut such as `bun run start:html-publisher` instead of treating the workspace root as the service package.

The Tailscale port dashboard is not a Railway service. Install it on the VM with `services/tailscale-port-dashboard/ops/install-systemd.sh`; the unit is enabled for VM boot through `multi-user.target`.
