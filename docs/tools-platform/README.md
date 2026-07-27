# Tools Platform operations

These runbooks cover the migration from the Cloudflare uptime Worker to the
Railway Tools Platform:

- [preview-and-cutover.md](./preview-and-cutover.md) — isolated preview,
  checker shadow operation, production cutover, Worker retirement, and rollback.
- [bucket-recovery.md](./bucket-recovery.md) — object ownership, export, restore,
  and corruption recovery.
- [access-incident.md](./access-incident.md) — Cloudflare Access containment and
  recovery.
- [rename-migration.md](./rename-migration.md) — service and repository naming
  changes without breaking stable URLs.
- [uptime-parity-audit.md](./uptime-parity-audit.md) — evidence used before
  deleting the legacy Worker source.

The architecture has two deliberately different Railway processes:

- `tools-web` is a Serverless-enabled request/response service. It has no
  scheduler, background polling, analytics, or telemetry loop and can sleep.
- `tools-checker` is a short-lived cron process scheduled at `*/5 * * * *`. It
  performs one bounded pass and exits.

Both use one private bucket, but ownership is enforced in code. Web writes only
`catalog/current.json` and immutable `audit/**` objects. Checker writes only
state, snapshots, history, recovery, and export prefixes.

The low-traffic planning estimate is roughly $0.30–$1.50/month incremental, not
a billing guarantee. Configure Railway CPU/RAM limits, project usage alerts,
and a monthly spend cap where the account supports one. Review actual usage
after 24 hours and again after one billing week.
