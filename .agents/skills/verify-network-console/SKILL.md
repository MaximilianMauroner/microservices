---
name: verify-network-console
description: Verify Network Console through its live dashboard and HTTP endpoints in an owned loopback process. Use for Network Console acceptance checks.
---

# Verify Network Console

Read `AGENTS.md`, `services/network-console/README.md`, and
[the feature map](features/README.md). Do not use Docker or an installed service.

## Launch

From the repository root, check active processes, Git status, and port 43127.
Use Node >=22.12 and pnpm 11.16.0. Install dependencies with
`pnpm install --frozen-lockfile`. Start an owned terminal session:

```sh
BIND_HOST=127.0.0.1 PORT=43127 pnpm --dir services/network-console start
```

Wait for `network-console listening on 127.0.0.1:43127`. Require `/health` and
`/api/ports` to succeed. No database, bucket, or seed is needed.

## Doctor

```sh
curl -fsS http://127.0.0.1:43127/health
lsof -nP -iTCP:43127 -sTCP:LISTEN
```

Require `{"ok":true}` and the listener owned by the terminal from this run.
Do not drive a pre-existing instance that happens to answer on this port.

## Drive

Use T3 preview status, open, navigate, and snapshot for the real dashboard.
Use HTTP for `/health` and `/api/ports`. Follow the feature map. Never run the
systemd installers or change the installed Network Console service.

## Evidence

Save command output, exit codes, JSON, and browser captures under
`.agents/artifacts/<run-id>/`. Record the revision, terminal handle, bind address,
and feature ID. Hostnames, network addresses, and process details are private.
A JSON check alone does not prove the dashboard rendered.

## Cleanup

Send SIGINT through the exact terminal handle from Launch. Confirm port 43127
is closed. Retain the evidence and verify its files still exist.

## Helpers

The repository's `start` command is the launcher. `curl` and `lsof` are the
read-only doctor. There is no extra helper to install.
