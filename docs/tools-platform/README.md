# Tools Platform operations

These runbooks cover the migration from the Cloudflare uptime Worker to the
Railway Tools Platform:

- [preview-and-cutover.md](./preview-and-cutover.md) — short migration notice
  pointing old split-deployment operators to the unified runbook.
- [bucket-recovery.md](./bucket-recovery.md) — object ownership, export, restore,
  and corruption recovery.
- [access-incident.md](./access-incident.md) — Cloudflare Access containment and
  recovery.
- [rename-migration.md](./rename-migration.md) — service and repository naming
  changes without breaking stable URLs.
- [uptime-parity-audit.md](./uptime-parity-audit.md) — evidence used before
  deleting the legacy Worker source.
- [consolidation-cutover.md](./consolidation-cutover.md) — current
  single-service deployment, Access routing, verification, and rollback.

The production architecture has one Railway process: `platform-service` mounts
the catalog, publisher, and field-guide routes and runs the bounded checker on
five-minute boundaries. The redacted Tools home and status surface are public.
Artifact/file `GET`/`HEAD` delivery is public and unlisted: possession of an
unguessable URL grants read access while the backing bucket stays private.
Cloudflare Access remains the outer authentication layer for Publish
upload/list/revoke surfaces, Review, Manage, and their protected legacy browser
aliases. Native upload and agent automation routes bypass browser Access and
continue to use their existing bearer credentials.

The catalog and checker use one private bucket, but ownership is enforced in code. Web writes only
`catalog/current.json` and immutable `audit/**` objects. Checker writes only
state, snapshots, history, recovery, and export prefixes.

The fixed `/assets/ops.js` browser asset is public so authenticated Manage HTML
can boot after routing through the gateway; it is not an authentication
boundary. `/manage`, all `/api/ops/*` data and mutations, Publisher upload/list
surfaces, and Review remain protected. Public directory and status pages emit
canonical/Open Graph metadata; protected pages are no-store and noindex.

The unified service cannot use Railway Serverless sleep because it owns the
checker schedule. Review actual usage after 24 hours and again after one
billing week.
