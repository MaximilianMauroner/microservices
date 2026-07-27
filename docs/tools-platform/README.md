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
- [consolidation-cutover.md](./consolidation-cutover.md) — single-service
  deployment, Access service-token wiring, verification, and rollback.

The production architecture has one Railway process: `platform-service` mounts
the catalog, publisher, and field-guide routes and runs the bounded checker on
five-minute boundaries. The redacted Tools home and status surface are public;
Cloudflare Access is the single outer authentication layer for Publish,
artifact/file delivery, Review, Manage, and their legacy browser aliases. The
checker and automation clients use an Access service token in
addition to their existing inner bearer credentials.

The catalog and checker use one private bucket, but ownership is enforced in code. Web writes only
`catalog/current.json` and immutable `audit/**` objects. Checker writes only
state, snapshots, history, recovery, and export prefixes.

The unified service cannot use Railway Serverless sleep because it owns the
checker schedule. Review actual usage after 24 hours and again after one
billing week.
