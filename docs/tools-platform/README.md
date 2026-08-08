# Tools Platform operations

The production architecture has one Railway process. `platform-service` mounts
the catalog, publisher, and Field Guide routes and runs the bounded checker.
Public pages and canonical artifact/file reads stay unauthenticated. Human
private routes share one stateless Better Auth Google session. Machine upload,
agent, and heartbeat routes retain their native bearer tokens.

- [preview-and-cutover.md](./preview-and-cutover.md): isolated verification.
- [consolidation-cutover.md](./consolidation-cutover.md): production cutover and rollback.
- [access-incident.md](./access-incident.md): browser-authentication containment and recovery.
- [bucket-recovery.md](./bucket-recovery.md): object export, restore, and corruption recovery.
- [rename-migration.md](./rename-migration.md): naming changes without breaking canonical URLs.
- [uptime-parity-audit.md](./uptime-parity-audit.md): legacy checker parity evidence.

The service cannot sleep because it owns the checker schedule. Private responses
are no-store and noindex. Authentication adds no database and does not change
bucket ownership.
