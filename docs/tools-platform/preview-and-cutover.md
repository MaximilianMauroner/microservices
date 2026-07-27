# Preview, shadow, cutover, and rollback

## Isolated Railway preview

Never point a preview service at the production bucket.

1. Create a preview bucket and distinct `TOOLS_ENVIRONMENT` value.
2. Deploy `tools-web` with Railway Serverless enabled and a preview-only domain.
3. Create a separate Cloudflare Access application and audience for `/ops*` and
   `/api/ops/*`; configure that audience and team issuer in the preview service.
4. Upload `apps/tools-web/config/initial-catalog.json` to
   `catalog/current.json` with an S3 `If-None-Match: *` conditional write, or
   send it to `PUT /api/ops/catalog` with `If-None-Match: *` and a valid preview
   Access assertion. A `409` means the bucket is already initialized; inspect it
   instead of overwriting it.
5. Leave `DISCORD_WEBHOOK_URL` unset. Run the checker manually once against the
   preview bucket, then verify all four generated object families decode.
6. Enable the preview cron only after the manual pass succeeds.

“Shadow mode” is an operational procedure, not a hidden application flag:
use the isolated preview bucket, keep notifications disabled, and leave
cutover-dependent monitors paused. Never shadow-write production state.

## Pre-cutover gates

- Confirm `tools-web` sleeps between requests and has no background traffic.
- Confirm `tools-checker` runs at `*/5 * * * *`, logs one terminal event, closes
  its S3 client, and exits successfully.
- Confirm the public HTML and `/api/public/catalog` contain no private notes,
  private links, Access claims, notification errors, or webhook values.
- Confirm `/ops*` and `/api/ops/*` fail closed both at Cloudflare Access and in
  the app's JWT verifier.
- Confirm `uploads.mauroner.eu` DNS and the restricted upload route before
  resuming that seed monitor. It was unresolved during planning.
- Recheck the production legacy D1 immediately before cutover:

  ```bash
  bunx wrangler d1 execute uptime-monitor --remote --command \
    "SELECT (SELECT COUNT(*) FROM monitors) AS monitors, (SELECT COUNT(*) FROM checks) AS checks, (SELECT COUNT(*) FROM incidents) AS incidents"
  ```

  Run this using an authenticated Cloudflare environment. The planning-time
  result was empty, but that is not permission to assume it remains empty. If
  any count is non-zero, stop and export/migrate the rows before retirement.

## Production cutover

1. Export the production bucket before every mutation; see bucket recovery.
2. Initialize `catalog/current.json` conditionally from the reviewed seed.
3. Deploy `tools-web`, enable Railway Serverless, attach the production bucket,
   and verify `/health` plus the Railway deployment health check.
4. Deploy `tools-checker` with cron `*/5 * * * *`, notifications still unset,
   and run one manual pass.
5. Inspect `state/current.json`, both snapshots, today's gzip history, and the
   public/private pages. Tailscale monitoring must say
   `unavailable_from_railway`, not `down`.
6. Configure the Discord webhook only after state and incident transitions are
   verified. Observe two cron slots.
7. Point `tools.mauroner.net` at `tools-web`; verify TLS, public cache behavior,
   Access path matching, and application-level Access rejection.
8. Resume the Tools Directory monitor after the new domain is live. Resume the
   Artifact Publisher only after its intended stable DNS and health route work.

## Retire the Cloudflare Worker

Do not delete it immediately. First remove its cron trigger, leaving the Worker
and D1 intact for rollback. After the Railway checker has completed at least two
healthy slots:

1. Route `uptime.mauroner.eu` to a temporary redirect to
   `https://tools.mauroner.net/ops` if that legacy hostname must remain useful.
   Preserve Cloudflare Access on the legacy route.
2. Record the deployed Worker version, route, Access application, D1 database
   ID, and last D1 export.
3. Keep the Worker disabled but deployable through the rollback window.
4. Delete external Worker/D1 resources only in a later, explicitly approved
   infrastructure change. This repository change does not mutate them.

## Rollback

1. Disable the Railway checker cron first to stop new bucket state writes.
2. Restore the last known-good bucket objects if corruption caused the rollback.
3. Restore the previous Cloudflare Worker route/version and its cron.
4. Restore `uptime.mauroner.eu` from the redirect to the Worker.
5. Revert the `tools.mauroner.net` DNS/origin change or leave a static maintenance
   response; do not expose `/ops` without Access.
6. Verify one Worker scheduled slot and Discord delivery state before declaring
   rollback complete.
