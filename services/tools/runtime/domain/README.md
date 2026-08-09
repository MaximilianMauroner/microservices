# Tools runtime domain

Pure contracts used by Dashboard and Status inside the Tools monolith. This
runtime module has multiple product consumers, but it is not a repository-wide
shared package or an independent service. It owns:

- schema-versioned catalog, checker state, public/private snapshot, and audit
  contracts;
- explicit forward migration and decoding entrypoints;
- incident and monitor state transitions;
- strict public snapshot projection;
- monitor URL and literal-address validation; and
- canonical keys for derived object-storage projections.

It intentionally has no storage client, HTTP server, environment access,
logging, timers, or Railway-specific behavior.

Mutable object decoders are `decodeCatalogDocument`,
`decodeCheckerStateDocument`, and `decodeHistoryPartitionDocument`; their
corresponding `migrate*` functions perform explicit v0-to-v1 forward migration.
Snapshot and audit readers use
`decodePublicSnapshotDocument`, `decodePrivateSnapshotDocument`, and
`decodeAdminAuditRecord`.

Canonical fixed projection keys are exported as `BUCKET_KEYS`. PostgreSQL is
the authority for current checker state and history; object-storage documents
are compatibility-free output projections and recovery exports only.
