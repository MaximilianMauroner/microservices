# Paired backup guard: logical comparison replaces the WAL position check

The release helper no longer compares PostgreSQL WAL insert positions.
Backup and verification now detect database change only by full logical
comparison of the `tools` and `artifacts` row inventories. Production source
checks still compare only `artifacts` rows.

## Premise that failed

The old fixture guard assumed this premise. If the cluster WAL insert position
moves, relevant logical content changed.

The retained runtime evidence contradicts the premise. In each failed
interval, every record has `tx: 0`. No record is product DML.

- Source backup, interval `0/21FED00` to `0/21FF118`. There are 12 `Heap2 PRUNE`
  records on relation 2619, `pg_statistic`. The source is
  `wal-source-final-diagnostic.log` in the primary artifacts.
- Earlier source backup. There are `Heap2 PRUNE` records on `upload_sessions`.
  The source is `wal-prune-diagnosis.log`.
- Restore verification, interval `0/1FBC890` to `0/1FBCD50`. There are 16
  `Heap2 PRUNE` records on `pg_class` and `pg_attribute`, and one `Standby
  RUNNING_XACTS` record. The source is `helper-http-date-r6/restore-wal-diagnostic.log`.

PostgreSQL prunes heap pages during ordinary reads. The bgwriter writes
`RUNNING_XACTS` periodically. The WAL position is shared by every database in
the cluster, and the restore targets share the source cluster. Thus a quiet
source and the helper's own read-only scans can move the position. The guard
rejected legitimate states. The guard was the fault, not the fixture.

## Options compared

1. Logical before and after comparison. This option was chosen.
   - It uses the existing `databaseState` inventory. The backup already wrote
     `database-after.json` after both bucket reads. Verification now reads the
     inventory a second time after the second bucket listing.
   - It detects every net change to a `tools` or `artifacts` row between the
     exported snapshot and the final read. A concurrent relevant writer still
     fails the backup with `Concurrent database writes or cleanup invalidated
     the backup`. Verification fails with `The database changed during
     verification`.
   - It is the same mechanism that production source checks already used.
2. Filtered WAL. Decode the interval with `pg_walinspect` and reject only
   records that have a transaction ID and touch product relations.
   - This needs a new extension in each database, which is a write, and
     elevated privileges. Managed production PostgreSQL does not provide this,
     so it would prove a property that production never gets.
   - It needs a relfilenode map that table rewrites invalidate, and a
     version-specific allowlist of record types.
3. Next transaction ID stability. Compare `pg_snapshot_xmax` before and after.
   - The counter is cluster-wide. Autovacuum `ANALYZE` assigns transaction IDs
     when it writes `pg_statistic`. The result depends on autovacuum timing,
     so it is a timing workaround. It was rejected.

## Limits of the chosen guard

The quiet source remains a precondition. The manifest still records
`requiresQuiescentSource: true` and `atomicBucketSnapshot: false`.

- A writer that changes a row and then restores identical content inside the
  window is not detected. The WAL guard detected this in fixtures only. The
  database side does not depend on it, because `database.json` and the dump
  share one exported snapshot. `references` checks directly that every live
  canonical row has its body with the correct size and digest.
- A transaction that is open before the snapshot and commits after the final
  read is not visible. The active session block, the bucket listings, and the
  quiet source precondition cover this. An orphan body from such a writer is
  captured and is a valid recovery state.
- The comparison covers tables only. The `tools` and `artifacts` schemas have
  no sequences. `pg_dump` still dumps the complete schemas.

## Unchanged guards

Historical journals can still be captured, and preflight still blocks them.
Full body reads, the dump, raw hashes, metadata, tags, source identity, the
empty-owner restore claim, the production `artifacts`-only comparison, and the
quiet-source requirement are unchanged.

New manifests omit `startWal` and `endWal`. No reader uses these fields, so
existing backups still load.
