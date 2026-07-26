# Field guide review

Review-only service for immutable project and global field-guide candidates. SQLite on a Railway volume is the production source of truth; PostgreSQL remains available temporarily for cutover import and recovery.

## Runtime configuration

Set `DATABASE_BACKEND=sqlite`, `SQLITE_PATH=/app/data/field-guide.sqlite`, `AGENT_API_TOKEN`, `SHOO_ALLOWED_EMAIL`, and `PUBLIC_BASE_URL`. `PORT` defaults to `3000`. Attach exactly one persistent volume at `/app/data` and run exactly one application replica. SQLite uses WAL, foreign-key enforcement, a five-second busy timeout, and `synchronous=NORMAL`.

Startup opens the volume database, applies committed migrations, verifies foreign keys, and only then binds the HTTP listener. Set `IMPORT_POSTGRES_ON_START=true` plus `DATABASE_URL` only for the controlled first import. A destination with identical counts and logical hashes is an idempotent no-op; a nonempty differing destination fails closed unless `FIELD_GUIDE_IMPORT_ALLOW_OVERWRITE=yes` is explicitly supplied. Remove the import variables after a successful cutover.

The Railway deployment has no pre-deploy database command because the mounted volume is unavailable then. Enable Railway Serverless after cutover; cold starts are accepted. Keep one replica while SQLite is authoritative.

## Cutover

1. Back up PostgreSQL and schedule a brief maintenance window that stops writes.
2. Attach the volume at `/app/data` and deploy with the SQLite variables, temporary `DATABASE_URL`, and `IMPORT_POSTGRES_ON_START=true`.
3. Capture the import's table/count/hash/max-sequence report. Confirm all five tables, relationships, representative Unicode/JSON/timestamp values, `/health`, queue/history, decision idempotency, and amendment behavior.
4. Remove `IMPORT_POSTGRES_ON_START` and `DATABASE_URL`, redeploy, and verify restart plus sleep/wake persistence.
5. Enable Serverless and observe sleeping state. Keep PostgreSQL during the rollback window; deleting it requires separate approval.

Back up the database only after checkpointing it (`PRAGMA wal_checkpoint(TRUNCATE)`), then copy the SQLite file or take a volume snapshot. A filesystem copy made while writes continue must include the `-wal` and `-shm` files.

## Recovery and rollback

To restore post-cutover writes to a freshly schema-initialized PostgreSQL database, set `RECOVERY_DATABASE_URL` and `FIELD_GUIDE_RECOVERY_CONFIRM=field-guide-review-recovery`, then run `bun run db:recover-postgres`. Recovery fails closed when the target is nonempty unless `FIELD_GUIDE_RECOVERY_ALLOW_NONEMPTY=yes` is deliberately set. It inserts in foreign-key-safe order, preserves event sequences, resets the PostgreSQL sequence, and compares logical hashes before committing.

For application rollback, stop writes, run recovery, set `DATABASE_BACKEND=postgres` and `DATABASE_URL`, then redeploy. Do not delete or detach the SQLite volume until integrity is confirmed.

## Development

Run `bun run db:generate` after changing `src/db/schema.ts`; committed migrations live in `drizzle/`. `src/db/postgres-schema.ts` exists only for gated disposable-PostgreSQL recovery verification. Use `bun run verify` for typechecking and the full test suite. PostgreSQL integration and round-trip tests must use `TEST_DATABASE_URL` and `FIELD_GUIDE_TEST_DATABASE_CONFIRM=field-guide-review-test`; never point them at production.

The disposable PostgreSQL database must contain this sentinel, created manually before tests:

```sql
CREATE TABLE public.field_guide_review_test_sentinel (
  sentinel_key text PRIMARY KEY,
  sentinel_value text NOT NULL
);
INSERT INTO public.field_guide_review_test_sentinel (sentinel_key, sentinel_value)
VALUES ('database-purpose', 'field-guide-review-disposable-test-database');
```

Agent API: `POST /api/agent/candidates`, `GET /api/agent/decisions`, and `POST /api/agent/receipts`. Reviewer API includes queue, paginated history, verdict, and append-only amendment endpoints. There are intentionally no update or delete routes.
