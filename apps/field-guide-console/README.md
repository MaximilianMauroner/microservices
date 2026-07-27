# Field Guide Console

Review-only service for project and global field-guide candidates. Candidate content stays immutable; an initial undecided candidate may be reassigned between project and global scope using its recorded origin project. SQLite on a Railway volume is the production source of truth; PostgreSQL remains available temporarily for cutover import and recovery.

## Runtime configuration

Set `DATABASE_BACKEND=sqlite`, `SQLITE_PATH=/app/data/field-guide.sqlite`, `AGENT_API_TOKEN`, `SHOO_ALLOWED_EMAIL`, and `PUBLIC_BASE_URL`. `PORT` defaults to `3000`. Attach exactly one persistent volume at `/app/data` and run exactly one application replica. SQLite uses WAL, foreign-key enforcement, a five-second busy timeout, and `synchronous=NORMAL`.

Railway deploys this service from `apps/field-guide-console`. Its existing
public hostname, SQLite volume, single-replica requirement, and authentication
boundary are unchanged by the repository move.

Startup opens the volume database, applies committed migrations, verifies foreign keys, and only then binds the HTTP listener. Set `IMPORT_POSTGRES_ON_START=true` plus `DATABASE_URL` only for the controlled first import. A destination with identical counts and logical hashes is an idempotent no-op; a nonempty differing destination fails closed unless `FIELD_GUIDE_IMPORT_ALLOW_OVERWRITE=yes` is explicitly supplied. Remove the import variables after a successful cutover.

The Railway deployment has no pre-deploy database command because the mounted volume is unavailable then. Enable Railway Serverless after cutover; cold starts are accepted. Keep one replica while SQLite is authoritative.

## Cutover

1. Back up PostgreSQL and schedule a brief maintenance window that stops writes.
2. Attach the volume at `/app/data` and deploy with the SQLite variables, temporary `DATABASE_URL`, and `IMPORT_POSTGRES_ON_START=true`.
3. Capture the import's table/count/hash/max-sequence report. Confirm all five tables, relationships, representative Unicode/JSON/timestamp values, `/health`, queue/history, decision idempotency, and amendment behavior.
4. Remove `IMPORT_POSTGRES_ON_START` and `DATABASE_URL`, redeploy, and verify restart plus sleep/wake persistence.
5. Enable Serverless and observe sleeping state. Keep PostgreSQL during the rollback window; deleting it requires separate approval.

## Seven-day rollback gate

Record the cutover date as **Day 0 (`YYYY-MM-DD`)** in the deployment notes and retain PostgreSQL through **Day 7 (`YYYY-MM-DD`, exactly seven 24-hour periods later)**. Check and record each item daily:

- `/health` is successful and queue, history, verdict, receipt idempotency, and amendment flows remain correct.
- `PRAGMA integrity_check` returns `ok` and `PRAGMA foreign_key_check` returns no rows.
- Application logs contain no migration, integrity, corruption, or repeated startup failures; count and investigate every `SQLITE_BUSY` occurrence.
- Request latency remains within the pre-cutover baseline and has no sustained cold-start or write-latency regression.
- The volume remains mounted at `/app/data`, has adequate free space, and the database, WAL, and SHM sizes grow as expected.
- At least one checkpointed backup exists, and a restore drill into a separate temporary SQLite file passes integrity, foreign-key, table-count, logical-hash, max-sequence, and next-sequence checks.
- Serverless reaches `SLEEPING` while idle, wakes successfully, and retains identical logical hashes across sleep/wake and a normal redeploy.

On Day 7, recalculate measured monthly cost from Railway usage rather than assuming the estimate: compare the seven-day extrapolated application compute, volume, and network charges with the pre-cutover `$1.18/month` baseline and document whether the result is near the expected `$0.25/month`. Do not delete PostgreSQL merely because the estimate is met.

Rollback immediately if integrity or foreign-key checks fail, writes are lost or duplicated, next-sequence verification fails, the volume is missing, backup restore fails, `SQLITE_BUSY` errors are sustained, or health/latency regressions breach the recorded baseline. Stop writes, recover SQLite to PostgreSQL, verify logical equality, and deploy the PostgreSQL backend. PostgreSQL deletion is a separate destructive action requiring explicit approval after the dated Day 7 evidence is reviewed.

Back up the database only after checkpointing it (`PRAGMA wal_checkpoint(TRUNCATE)`), then copy the SQLite file or take a volume snapshot. A filesystem copy made while writes continue must include the `-wal` and `-shm` files.

## Recovery and rollback

To restore post-cutover writes to a freshly schema-initialized PostgreSQL database, set `RECOVERY_DATABASE_URL` and `FIELD_GUIDE_RECOVERY_CONFIRM=field-guide-console-recovery`, then run `bun run db:recover-postgres`. Recovery fails closed when the target is nonempty unless `FIELD_GUIDE_RECOVERY_ALLOW_NONEMPTY=yes` is deliberately set. It inserts in foreign-key-safe order, preserves event sequences, resets the PostgreSQL sequence, and compares logical hashes before committing.

For application rollback, stop writes, run recovery, set `DATABASE_BACKEND=postgres` and `DATABASE_URL`, then redeploy. Do not delete or detach the SQLite volume until integrity is confirmed.

## Development

Run `bun run db:generate` after changing `src/db/schema.ts`; committed migrations live in `drizzle/`. `src/db/postgres-schema.ts` exists only for gated disposable-PostgreSQL recovery verification. Use `bun run verify` for typechecking and the full test suite. PostgreSQL integration and round-trip tests must use `TEST_DATABASE_URL` and `FIELD_GUIDE_TEST_DATABASE_CONFIRM=field-guide-console-test`; never point them at production.

The disposable PostgreSQL database must contain this sentinel, created manually before tests:

```sql
CREATE TABLE public.field_guide_review_test_sentinel (
  sentinel_key text PRIMARY KEY,
  sentinel_value text NOT NULL
);
INSERT INTO public.field_guide_review_test_sentinel (sentinel_key, sentinel_value)
VALUES ('database-purpose', 'field-guide-console-disposable-test-database');
```

Agent API: `POST /api/agent/candidates`, `GET /api/agent/decisions`, and `POST /api/agent/receipts`. Reviewer API includes queue, paginated history, verdict, append-only amendment, and pre-approval scope-reassignment endpoints. Candidate content and recorded decisions have no update or delete routes.
