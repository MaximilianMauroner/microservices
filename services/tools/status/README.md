# Status

Status is presented by Tools and checked by a separate Railway cron service.
Railway starts `pnpm --dir services/tools/status run start` every 30 minutes
from this directory's `railway.json`; the process runs one bounded monitoring
pass, closes its resources, and exits.

Each pass stores runtime state in PostgreSQL, publishes derived snapshots, and
drains due Discord notifications. Deterministic run IDs and transactional
revision checks keep repeated invocations idempotent.

## Required configuration

- `TOOLS_ENVIRONMENT`: URL-safe environment identity included in deterministic
  run IDs. Run IDs retain five-minute slots, so retries in the same slot reuse
  the original ID and remain idempotent.
- `DATABASE_URL`: Postgres connection used for runs, observations, incidents,
  heartbeats, pause overrides, checker state, and history.
- `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`: private Railway Bucket credentials.
- `S3_FORCE_PATH_STYLE`: optional `true`/`false`, default `false`.
- `CHECK_CONCURRENCY`: optional `1..32`, default `6`.
- `PROBE_TIMEOUT_MS`: optional total probe timeout `1000..60000`, default
  `10000`.
- `TOWER_HEARTBEAT_STALE_AFTER_MS`: optional Tower heartbeat freshness window,
  default 40 minutes for the production 30-minute heartbeat cadence.
- `DISCORD_WEBHOOK_URL`: optional; when absent, pending notifications remain in
  the durable outbox.

Product presentation metadata is deployed from
`dashboard/config/initial-catalog.json`. Monitor identity, URLs, scope, expected
status, and timeouts come from typed definitions in `src/definitions.ts` and are
checked for matching IDs at startup. Runtime state and history use transactional
revision checks in PostgreSQL. The bucket contains only derived public/private
snapshots and is never the runtime authority.

Every active, enabled, unpaused monitor is processed once per run. Tailscale
scope produces `unavailable_from_railway` without a fetch. Public probes retain
the Worker behavior: GET, a ten-second total timeout by default, manual redirect
handling with at most one redirect, literal-address validation before both
requests, and 2xx–3xx success.

Raw observations older than 30 days are removed from history partitions while
incident records remain. Discord delivery is at least once: pending state is
persisted before delivery, and failed delivery uses `Retry-After` or capped
exponential backoff.

Configure the Railway service to use `/services/tools/status/railway.json` and
provide the required variables. Configure explicit CPU/RAM limits and a project
usage alert. The 30-minute production cadence lets the monitored Tools service
and PostgreSQL sleep between checks. Checker shutdown is bounded and awaits
database and snapshot-store cleanup before exiting.
