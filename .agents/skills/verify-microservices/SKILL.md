---
name: verify-microservices
description: Verify Network Console, the Tools products, and Markdown Share through isolated public paths.
---

# Verify Microservices

Use [the feature index](features/README.md) to select journeys and record gaps.
Use each extension for its feature-specific setup, actions, and cleanup.

## Automated workspace verification

Run `pnpm run verify` for the automated workspace checks. The command validates
tracked files, checks that inherited database and storage settings are absent,
discovers the required cases, and creates an owned loopback PostgreSQL fixture.
It then runs Tools typecheck, tests, and build, pushes the test schema, and runs
the required PostgreSQL contracts.

Next, it discovers and runs the required identity and journey cases. Identity
contracts start an owned MinIO container and reuse the PostgreSQL fixture. The
stage seeds its buckets, checks a signed upload, CORS, and readable `ETag`, then
runs the identity suite.

Journeys use a separate Compose project with PostgreSQL and MinIO. The runner
seeds both services, starts the Tools server from the build above, checks
readiness and Document Share HTTP access, checks signed storage, and runs the
required public journeys. Each receipt cell records its elapsed time in
`durationMs`. Use those times to find the slow stage before changing tools or
removing checks.

The runner resolves MinIO from a verified local image, a saved archive, or a
Docker build. The default archive directory is `$XDG_CACHE_HOME/tools-verify`
or `$HOME/.cache/tools-verify`. Set `TOOLS_VERIFY_CACHE_DIR` to use another
directory. GitHub Actions stores this directory under the runner temp directory.
It can save an archive after a failed verification run unless the run is
cancelled, but only when a nonempty `minio-*.tar` archive exists. The resolver
publishes the archive by atomic rename after Docker saves the image. This keeps
a completed MinIO build when a later verification stage fails. The cache key
includes the runner OS and architecture and hashes the Dockerfile and resolver
source. The shared MinIO image and archive remain after Compose cleanup.

The runner stops after a failed or blocked stage. It records results and
fixture cleanup in `.agents/artifacts/verify/runtime-<id>/receipts.json`.

A passed automated receipt means every required automated check and fixture
cleanup passed. It does not prove local Google OAuth or browser upload. Read
`manualAcceptance` in the receipt and report each manual gate separately.

Read repository `AGENTS.md`, each service README, and
`docs/tools-platform/runtime-boundaries.md`. Record the commit, worktree, Node
and pnpm versions, selected journeys, instance ports, and evidence directory.
Check active threads, existing verification evidence, issues, and PRs first.
Run journeys one at a time. Source review and fixture rendering do not prove
a live journey.

## Isolated setup

Use a clean worktree. Check memory, load, free disk, and listeners before
installing or building. Use Node >=22.12 and pnpm 11.16.0. The verification
CLI uses the Tools package's `tsx` runner for TypeScript files.
Run `pnpm install --frozen-lockfile`. Keep captures under ignored
`.agents/artifacts/<run-id>/`; keep credentials out of evidence.

For Network Console, select an unused port and run:

```sh
BIND_HOST=127.0.0.1 PORT=43127 pnpm --dir services/network-console start
```

Record the terminal session handle. Require `GET /health` to return
`{"ok":true}` before the Network Console journey. Do not start or change the installed system service.

For Tools, inspect `compose.yaml` and all existing listeners first. Its
checked-in stack publishes fixed host ports 3000, 5432, 9000, and 9001.
Use a unique Compose project and a temporary override that remaps every
published port to unused loopback ports. Set the platform's `PUBLIC_ORIGIN`
and seed browser origin to the chosen Tools origin. Confirm with
`docker compose ... config` before launch. Do not use an existing database,
bucket, service, or volume. Record the exact project, overrides, and resolved
configuration with secrets removed. Use the exact private environment and key
override in the root README's Local stack section, then add the run's port and
origin override to the same explicit Compose invocation. The README example
uses the fixed ports and does not provide the required audit remapping. Compose
omits `FEEDBACK_ENCRYPTION_KEY` and `BODYSHOP_ENCRYPTION_KEY`; configuration rejects startup without them.
Keep the key only in the owned private environment file outside the checkout
and retain it until test response cleanup ends. Use `config --quiet` for the
unredacted setup; never save a resolved key to evidence.

Before Publisher journeys, apply the feature's
[storage prerequisites](features/publisher.md#storage-prerequisites).

Require both `/live` and `/health`
to succeed; Compose's health check only checks `/live`.

The sample OAuth values cannot verify login. Use a local OAuth client and the
allowed test subject for private pages. Do not copy production secrets.
Document Share uses the same owned PostgreSQL database as Tools. Public
creation, editing, presence, pinning, and checkpoints need no Google OAuth.
Require a real public creation and open through `/api/share/documents` before
the browser journey. Private inventory still requires the unchanged browser
session. Use two independent browser contexts for simultaneous edits and
one-context offline recovery. Record process restart persistence separately.
Use only owned fixture records for bounded expiry tests. Never change system
time or use production state.

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
Document Share, use the recorded owned PostgreSQL fixture cleanup. No document
deletion UI is available. Preserve the redacted evidence directory.
Retain evidence after cleanup and confirm owned listeners have closed.

Report passed, failed, blocked, and unrun journeys separately. Include the
revision and setup, procedure changes, evidence, issues, and PRs. Report CI,
review, merge, and user acceptance independently.
