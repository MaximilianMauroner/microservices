# Tools Checker

Short-lived Bun process for Tools Platform monitoring. Railway runs it from
`jobs/tools-checker` on `*/5 * * * *`. It performs one bounded monitoring pass,
publishes bucket state and snapshots, drains due Discord notifications, logs a
terminal outcome, closes its S3 client, and exits. It never opens a listening
socket, starts a scheduler, or keeps a background service alive.

## Required configuration

- `TOOLS_ENVIRONMENT`: URL-safe environment identity included in deterministic
  five-minute run IDs.
- `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`: private Railway Bucket credentials.
- `S3_FORCE_PATH_STYLE`: optional `true`/`false`, default `false`.
- `CHECK_CONCURRENCY`: optional `1..32`, default `6`.
- `PROBE_TIMEOUT_MS`: optional total probe timeout `1000..60000`, default
  `10000`.
- `DISCORD_WEBHOOK_URL`: optional; when absent, pending notifications remain in
  the durable outbox.

Tools Checker reads `catalog/current.json` but cannot write it. It exclusively
writes `state/current.json`, both snapshots, daily gzip history partitions, and
recovery copies. State and history use conditional writes; malformed or missing
required objects fail with the object key but never log object bodies,
credentials, headers, webhook URLs, or full exceptions.

Every active, enabled, unpaused monitor is processed once per run. Tailscale
scope produces `unavailable_from_railway` without a fetch. Public probes retain
the Worker behavior: GET, a ten-second total timeout by default, manual redirect
handling with at most one redirect, literal-address validation before both
requests, and 2xx–3xx success.

Raw observations older than 30 days are removed from history partitions while
incident records remain. Discord delivery is at least once: pending state is
persisted before delivery, and failed delivery uses `Retry-After` or capped
exponential backoff.

Configure explicit Railway CPU/RAM limits and a project usage alert. The checker
is a cron service, not Serverless web traffic, and must reach a terminal
deployment state before Railway starts the next scheduled run.
