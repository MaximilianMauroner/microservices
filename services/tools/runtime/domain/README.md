# Tools Domain

Pure shared contracts for Tools Web and Tools Checker. This package owns:

- schema-versioned catalog, checker state, public/private snapshot, and audit
  contracts;
- explicit forward migration and decoding entrypoints;
- incident and monitor state transitions;
- strict public snapshot projection;
- monitor URL and literal-address validation; and
- canonical bucket object keys.

It intentionally has no storage client, HTTP server, environment access,
logging, timers, or Railway-specific behavior.

Mutable object decoders are `decodeCatalogDocument`,
`decodeCheckerStateDocument`, and `decodeHistoryPartitionDocument`; their
corresponding `migrate*` functions perform explicit v0-to-v1 forward migration.
Snapshot and audit readers use
`decodePublicSnapshotDocument`, `decodePrivateSnapshotDocument`, and
`decodeAdminAuditRecord`.

Canonical fixed keys are exported as `BUCKET_KEYS`. Use `historyKey`,
`auditKey`, `recoveryKey`, and `exportKey` for variable keys. Recovery objects
must stay below `recovery/`; periodic state exports stay below `exports/`.
