# Tailscale Port Dashboard

Local dashboard for remote-access orientation. It shows the machine's Tailscale address, listening TCP/UDP ports, inferred usage, process names when available, and remote targets for Tailscale-reachable TCP services.

## Endpoints

- `GET /`: HTML dashboard
- `GET /api/ports`: JSON snapshot
- `GET /health`: health check

## Run

```bash
bun run start
```

By default the service binds to the first IPv4 address from `tailscale ip -4`, then the first IPv6 address from `tailscale ip -6`, and uses port `80`. If Tailscale is unavailable, it falls back to `127.0.0.1` instead of exposing the dashboard on the LAN.

Optional environment:

- `PORT`: listen port, default `80`
- `LOCAL_NETWORK_PORT`: fallback listen port when `PORT` is unset
- `BIND_HOST`: explicit bind host, for example `100.x.y.z` or `0.0.0.0`
- `REQUIRE_TAILSCALE_BIND=true`: fail startup instead of falling back to `127.0.0.1` when no Tailscale address is available

Use `BIND_HOST=0.0.0.0` only when LAN exposure is intentional.

The dashboard has no application-level auth. It is intended to rely on binding to Tailscale plus tailnet ACLs as the access-control boundary. The page exposes hostname, Tailscale addresses, listening ports, and process names/PIDs when available.

Process details come from `ss -p`; some listeners may show no process owner unless the service has sufficient OS permissions.

## Systemd

`ops/install-systemd.sh` generates and installs a machine-local systemd unit that runs the service on port 80 with only `CAP_NET_BIND_SERVICE` added for low-port binding. It is a local VM service, not a Railway deployment.

Install and enable it at VM boot:

```bash
ops/install-systemd.sh
```

The unit requires `tailscaled.service`, starts after network readiness, and retries every 5 seconds if Tailscale is not ready when the VM boots.

The checked-in `.service` files are public-safe examples. Use the install scripts so the real unit is generated with the current repo path, user, and Bun executable on the VM.

Without sudo, install the user service and publish it through Tailscale Serve:

```bash
ops/install-user-service.sh
```

This starts the dashboard on the Tailscale address at `http://<tailscale-domain>:8080/`. For guaranteed VM boot before any login session, prefer the system service above.

Publishing the user service on port 80 without keeping the dashboard process privileged requires Tailscale Serve. On this VM, Tailscale Serve currently requires one privileged setup command:

```bash
sudo tailscale set --operator=$USER
tailscale serve --bg --http=80 8080
```

## Checks

```bash
bun run typecheck
bun run test
```
