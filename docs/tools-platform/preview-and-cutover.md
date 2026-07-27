# Preview, shadow, cutover, and rollback

## Isolated Railway preview

Never point a preview service at the production bucket.

1. Create a preview bucket and distinct `TOOLS_ENVIRONMENT` value.
2. Create `tools-checker` with source root `/jobs/tools-checker`, config path
   `/jobs/tools-checker/railway.json`, and start command `bun run start`. Keep
   its cron disabled until the manual validation pass.
3. As proposed preview limits, set each service to **0.25 vCPU and 256 MB RAM**.
   Set a project usage alert at **$2/month**, owned by the Railway project owner
   (Maximilian). These are external console gates, not settings completed by
   this repository. Record screenshots or an exported Railway configuration in
   the release evidence.
4. Create a separate Cloudflare Access application and audience for `/ops*` and
   `/api/ops/*`; configure that audience and team issuer in the preview service.
5. Upload `apps/tools-web/config/initial-catalog.json` directly to
   `catalog/current.json` with an S3 `If-None-Match: *` conditional write. A
   conflict means the bucket is already initialized; inspect it instead of
   overwriting it. The protected catalog API is not a bootstrap path because
   strict Tools Web readiness requires the catalog and public snapshot first.
6. Leave `DISCORD_WEBHOOK_URL` unset. Run the checker manually once against the
   preview bucket, then verify state, public/private snapshots, and today's
   history partition all decode.
7. Create `tools-web` with source root `/apps/tools-web`, config path
   `/apps/tools-web/railway.json`, and start command `bun run start`. Set
   `PUBLIC_ORIGIN` to the exact preview HTTPS origin, enable Railway Serverless,
   attach only the preview domain, and verify `/health`.
8. Enable the preview checker cron only after the manual pass and Tools Web
   readiness both succeed.

“Shadow mode” is an operational procedure, not a hidden application flag:
use the isolated preview bucket, keep notifications disabled, and leave
cutover-dependent monitors paused. Never shadow-write production state.

## Pre-cutover gates

- Confirm `tools-web` sleeps between requests and has no background traffic.
  Do **not** probe `/health`, `/`, or any origin route during this observation:
  an external probe would itself reset the inactivity window. Keep the Tools
  Directory entry unmonitored, use Railway replica/CPU metrics and logs to
  observe scale-to-zero after the documented inactivity window, then make one
  operator request and record the cold-start/scale-up. Disable third-party
  uptime probes and synthetic browser checks during this gate.
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
  Record the command timestamp, database identity, three counts, and operator
  in release evidence. This is an external cutover gate; the repository does
  not prove it has been performed.

## Production cutover

1. Export the production bucket before every mutation; see bucket recovery.
2. Initialize `catalog/current.json` conditionally from the reviewed seed.
3. Deploy `tools-checker` with its cron still disabled and notifications unset,
   then run one manual pass.
4. Inspect `state/current.json`, both snapshots, and today's gzip history.
   Tailscale monitoring must say
   `unavailable_from_railway`, not `down`.
5. Deploy `tools-web`, set `PUBLIC_ORIGIN` to
   `https://tools.mauroner.net`, enable Railway Serverless, attach the
   production bucket, and verify `/health`, the Railway deployment health
   check, and the public/private pages.
6. Enable the checker cron at `*/5 * * * *`.
7. Configure the Discord webhook only after state and incident transitions are
   verified. Observe two cron slots.
8. Point `tools.mauroner.net` at `tools-web`; verify TLS, public cache behavior,
   Access path matching, and application-level Access rejection.
9. Keep the Tools Directory intentionally unmonitored: a five-minute self-probe
   would prevent the Serverless origin from sleeping. Resume the Artifact
   Publisher only after its intended stable DNS and health route work.

## Stuck checker recovery

The checker release must include a whole-process deadline shorter than the
five-minute schedule interval. Before enabling cron, force a probe timeout and a
storage failure and verify a non-zero terminal deployment event is logged and
the process exits. Configure a Railway deployment alert owned by Maximilian for
failed or non-terminal cron executions.

If a run remains active at the next slot:

1. Disable the cron schedule; do not start another manual run.
2. Capture the deployment ID, start time, last sanitized event, and current
   object ETags without downloading secrets into logs.
3. Stop the stuck deployment from Railway.
4. Verify `state/current.json` and both snapshots refer to a coherent completed
   run. Restore from `recovery/**` if they do not.
5. Deploy the previous known-good checker and run it once manually with Discord
   unset. Re-enable cron only after its terminal event and process exit.

## Audit repair

Catalog and audit writes are separate object-store operations, coordinated by a
durable intent protocol. Each mutation creates an immutable intent before the
conditional catalog write, then creates the canonical audit object. Failed
catalog writes create immutable cancellation markers. A canonical-write failure
does not turn a committed catalog mutation into an HTTP 500: the next mutation
or protected `GET /api/ops/audit` repairs eligible pending intents
idempotently.

If a catalog revision appears without its canonical audit object, remove web
write credentials, export the catalog and complete `audit/**` prefix, and
record an operator incident. Issue an authenticated audit read to invoke repair,
then confirm the canonical object exists and the operations UI lists it. Never
rewrite or delete an existing audit object. Restore admin writes only after the
missing revision is represented and a create-only collision test succeeds.

## Trusted-admin DNS risk

Public monitor URLs are entered only by trusted, Access-authenticated
administrators. The checker rejects private/reserved **literal** addresses and
revalidates redirect literals, but it does not resolve and pin DNS answers.
DNS rebinding between validation and connection is therefore an accepted
residual risk for this trusted-admin deployment model; documentation must not
claim DNS pinning. Revisit the model before granting catalog administration to
untrusted users or accepting monitor URLs from another system.

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
