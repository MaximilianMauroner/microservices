---
name: verify-microservices
description: Verify Network Console, the Tools products, and Markdown Share through isolated public paths.
---

# Verify Microservices

Use [features.md](features.md) to choose journeys and record gaps. This is a draft:
Network Console HTTP was exercised at `9601243`; other journeys require their
own live evidence. Use [document-share.md](document-share.md) for the combined
Markdown/LaTeX journeys, isolated Convex setup, and current execution limits.

Read repository `AGENTS.md`, each service README, and
`docs/tools-platform/runtime-boundaries.md`. Record the commit, worktree, Node
and pnpm versions, selected journeys, instance ports, and evidence directory.
Check active threads, existing verification evidence, issues, and PRs first.
Run journeys one at a time. Source review and fixture rendering do not prove
a live journey.

## Isolated setup

Use a clean worktree. Check memory, load, free disk, and listeners before
installing or building. Use Node >=22.12 and pnpm 11.16.0.
Run `pnpm install --frozen-lockfile`. Keep captures under ignored
`.agents/artifacts/<run-id>/`; keep credentials out of evidence.

For Network Console, select an unused port and run:

```sh
BIND_HOST=127.0.0.1 PORT=43127 pnpm --dir services/network-console start
```

Record the terminal session handle. Require `GET /health` to return
`{"ok":true}` before N1. Do not start or change the installed system service.

For Tools, inspect `compose.yaml` and all existing listeners first. Its
checked-in stack publishes fixed host ports 3000, 5432, 9000, 9001, and 8787.
Use a unique Compose project and a temporary override that remaps every
published port to unused loopback ports. Set the platform's `PUBLIC_ORIGIN`
and seed browser origin to the chosen Tools origin. Confirm with
`docker compose ... config` before launch. Do not use an existing database,
bucket, service, or volume. Record the exact project, overrides, and resolved
configuration with secrets removed. Generate an owned local
`FEEDBACK_ENCRYPTION_KEY` with the command in `services/tools/feedback/README.md`
and inject it into the platform environment before launch. Compose omits this
required key; configuration rejects startup without it. Keep it only in the
owned private environment file and retain it until test response cleanup ends.

Compose also uses `ARTIFACT_S3_ENDPOINT=http://minio:9000`. Signed redirects
use that endpoint, which a host browser cannot resolve. P2 is blocked until
the owned storage endpoint is reachable by both Tools and the browser and its
CORS configuration permits the test origin and range playback. Record the
actual endpoint and CORS check without credentials. Do not rewrite a signed
URL hostname after signing. This storage setup has not been exercised.

Require both `/live` and `/health`
to succeed; Compose's health check only checks `/live`.

The sample OAuth values cannot verify login. Use a local OAuth client and the
allowed test subject for A1 and private pages. Do not copy production secrets.
Markdown needs a separately owned local Convex backend and its actual URL as
`VITE_CONVEX_URL`. The port-8787 administration mock does not implement
the browser protocol. If these prerequisites are missing, mark the dependent
journeys blocked rather than using mocked authentication or server functions.
The exact remapped Tools setup remains unverified. Markdown administration
only lists documents. Use a separately owned disposable local backend whose
process and data directory can be disposed of after the run. If this cleanup
path cannot be established, do not create documents and mark M1/M2 blocked.

## Execution and cleanup

Use T3 preview status, open, navigate, and snapshot for browser journeys.
Record browser reachability separately from HTTP readiness. Capture each
public action, result, console errors, and relevant state change. After a
surprising result, recheck dependency health, reset only owned state, and retry
once before classifying procedure drift, harness failure, or regression.

Stop only the terminal sessions and Compose project created by this run.
Use `docker compose -p <owned-project> ... down` without deleting shared
volumes. Record owned volumes for a later explicitly authorized cleanup.
Remove only test records created by the run through product controls. For
Document Share, stop the separately owned disposable backend and dispose of
its owned data directory as recorded before creation; no document deletion UI
is available. Preserve the redacted evidence directory.
Retain evidence after cleanup and confirm owned listeners have closed.

Report passed, failed, blocked, and unrun journeys separately. Include the
revision and setup, procedure changes, evidence, issues, and PRs. Report CI,
review, merge, and user acceptance independently.
