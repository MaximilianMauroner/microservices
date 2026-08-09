# Status

Status is a Tools product, not a separate Railway service. The Tools process
claims each deterministic five-minute slot through a PostgreSQL lease and runs
one bounded monitoring pass. A standalone CLI uses the same checker for
operations and tests.

Each pass stores runtime state in PostgreSQL, publishes derived snapshots,
drains due Discord notifications, and records a terminal lease outcome. Multiple
Tools replicas may be active; only the lease owner executes a given slot.

## Required configuration

- `TOOLS_ENVIRONMENT`: URL-safe environment identity included in deterministic
  five-minute run IDs.
- `DATABASE_URL`: Postgres connection used for runs, observations, incidents,
  heartbeats, pause overrides, checker state, and history.
- `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`: private Railway Bucket credentials.
- `S3_FORCE_PATH_STYLE`: optional `true`/`false`, default `false`.
- `CHECK_CONCURRENCY`: optional `1..32`, default `6`.
- `PROBE_TIMEOUT_MS`: optional total probe timeout `1000..60000`, default
  `10000`.
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

Configure explicit Railway CPU/RAM limits and a project usage alert. Tools must
remain awake so its in-process scheduler can claim slots. Checker shutdown is
bounded and awaits database and snapshot-store cleanup before releasing its
lease.
