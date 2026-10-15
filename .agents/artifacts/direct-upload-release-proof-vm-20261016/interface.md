# Run the paired backup and isolated restore proof

The callable tool is `services/tools/publisher/scripts/release-paired-backup.mjs`.
It uses the installed Publisher `postgres` and AWS S3 SDK packages.
It also needs matching `pg_dump` and `pg_restore` binaries on `PATH`.
Use Node.js 22.12 or newer.

All network targets must use literal `127.0.0.1` or `::1` addresses.
Connection URL options are forbidden.
Every database must have the disposable fixture sentinel.
This implementation has no production mode.

## Set the source fixture variables

Set these variables through the parent's owned native fixture runner.
Do not use production values or installed Fleet credentials.

```text
RELEASE_DATABASE_URL
RELEASE_S3_ENDPOINT
RELEASE_S3_BUCKET
RELEASE_S3_REGION
RELEASE_S3_ACCESS_KEY_ID
RELEASE_S3_SECRET_ACCESS_KEY
```

The source bucket can be `tools-transfer-test` or a name that starts with
`tools-release-` and contains lowercase letters, digits, and hyphens.
The tool exports every current object in that bucket, without a prefix filter.

Run each command from the checkout root.
On Coding VM, keep the primary repository path in `--repo` so all checks use
the same serial lock.

```bash
pnpm_config_verify_deps_before_run=false heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 -- node services/tools/publisher/scripts/release-paired-backup.mjs --help
```

## Check the legacy drain

Pass the actual temporary directory of every Tools process.
Repeat `--tmpdir` when processes use different directories.
An empty substitute directory does not prove that an existing process drained.

```bash
pnpm_config_verify_deps_before_run=false heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 -- node services/tools/publisher/scripts/release-paired-backup.mjs preflight --tmpdir "$TOOLS_OWNED_TMPDIR"
```

Exit code 0 means the observed legacy inventory and database have no blockers.
Exit code 2 reports known blockers as JSON.
Exit code 1 means an invalid input, an unreadable resource, an unsupported
storage feature, a pending S3 multipart upload, or another check failure.
Every nonzero exit blocks release.

Every `artifact-*` path blocks preflight, including expired chunk directories,
staged `artifact-publisher-*` files, symlinks, and unknown or malformed paths.
The tool reads chunk manifests without calling the application's stale-session
reader, which can delete expired local data.
It never removes or reconciles a legacy file.
Pending `artifacts.operations` rows block release even when their lease expired.
Active direct sessions and bucket multipart uploads also block release.

Run preflight again immediately before the approved release action.
The result is an observation, not a write barrier.
Max can abstain from uploads during this short window.
Caller inventory and every live replica remain the parent's responsibility.

## Capture a paired backup

Use a new private path outside the checkout for each attempt.
The parent directory must already exist.
The backup directory itself must not exist.

```bash
pnpm_config_verify_deps_before_run=false heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 -- node services/tools/publisher/scripts/release-paired-backup.mjs backup --tmpdir "$TOOLS_OWNED_TMPDIR" --directory "$RELEASE_BACKUP_PATH"
```

The backup contains these files.

- `database.dump` is a custom-format dump of the complete `tools` and `artifacts` schemas.
- `database.json` holds all canonical rows, journal rows, upload links, sessions, and receipts from the exported dump snapshot.
- `database-after.json` holds the final database inventory.
- `bucket-before.json` and `bucket-after.json` hold exact object listing fields.
- `bodies/<key-sha256>.bin` holds every raw bucket body, including retained versions, tombstone bodies, and unreferenced objects.
- `manifest.json` holds source identities, snapshot identity, WAL positions, raw SHA-256 values, writable object metadata, tags, and source ETags and modification times.
- `COMPLETE` holds the SHA-256 of `manifest.json` and appears only after all checks pass.

Rows are PostgreSQL JSON text strings inside the inventory.
The tool does not normalize journal payloads or parse and rebuild receipts.
Old JSON-string payloads, canonical identifiers, object keys, dates, nulls,
and large integer text remain intact.
The application retains its existing historical payload reader.

The exporter holds one read-only repeatable-read transaction open.
`pg_dump --snapshot` imports that exported snapshot.
The exporter compares full database inventories before and after the copy.
It reads and hashes every bucket body twice and compares exact metadata and tags.
It also compares bucket listings before and after both reads.
An advanced PostgreSQL WAL position rejects the backup, even if row contents
return to their first values.
This conservative guard can also reject unrelated writes in the same cluster,
autovacuum, or checkpoint activity.
Retry into a new directory after the fixture is quiet.

Legacy temporary files, active direct sessions, and active S3 multipart uploads
prevent backup completion.
The backup can capture pending journal rows unchanged for recovery tests.
Its `operations` count then remains nonzero and preflight still blocks release.
A completed backup does not replace a passing preflight.

## Prepare fresh restore targets

The parent creates a fresh empty database on the owned native PostgreSQL server.
Use a database name different from the source name, even on another cluster.
No product schema or public relation other than the sentinel may exist.

Set `RELEASE_RESTORE_OWNER` to a new random token of 16 to 40 lowercase letters
or digits.
Use a fresh token for every restore attempt.
Set these target variables explicitly.
The tool has no source-to-target credential fallback.

```text
RELEASE_RESTORE_DATABASE_URL
RELEASE_RESTORE_S3_ENDPOINT
RELEASE_RESTORE_S3_BUCKET=tools-release-restore-<owner>
RELEASE_RESTORE_S3_REGION
RELEASE_RESTORE_S3_ACCESS_KEY_ID
RELEASE_RESTORE_S3_SECRET_ACCESS_KEY
RELEASE_RESTORE_OWNER
```

Create the sentinel in the fresh target database.
The following command uses only the explicit target connection environment.

```bash
PGDATABASE="$RELEASE_RESTORE_DATABASE_URL" psql -X -v ON_ERROR_STOP=1 -v restore_owner="$RELEASE_RESTORE_OWNER" <<'SQL'
create table public.tools_runtime_test_sentinel (
  sentinel_key text primary key,
  sentinel_value text not null
);
insert into public.tools_runtime_test_sentinel values
  ('database-purpose', 'tools-runtime-disposable-test-database'),
  ('release-restore-owner', :'restore_owner'),
  ('release-restore-state', 'empty');
SQL
```

Create a fresh isolated bucket named `tools-release-restore-<owner>` through
the parent's owned S3 fixture client.
The bucket must be empty and have exactly these ownership tag values.

```text
tools-release-restore-owner=<owner>
tools-release-restore-state=empty
```

Restore claims the target sentinel and changes the bucket state tag to
`restoring` before it copies any data.
A failed restore leaves its partial fixture intact and cannot be retried over it.
Prepare another fresh database, bucket, and token for a retry.
No cleanup command is part of this tool.

## Restore and prove that the newer source survives

1. Run preflight and capture the first backup.
2. Create a newer upload in the original source through the real owned Tools process.
3. Capture a second backup of that newer source into `$RELEASE_NEWER_BACKUP_PATH`.
4. Prepare fresh restore targets as specified above.
5. Restore the first backup into those targets.

```bash
pnpm_config_verify_deps_before_run=false heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 -- node services/tools/publisher/scripts/release-paired-backup.mjs restore --directory "$RELEASE_BACKUP_PATH"
```

Restore validates all local backup hashes before connecting to its target.
It uses `pg_restore --single-transaction --exit-on-error` without `--clean`.
Every body write uses `If-None-Match: *`.
An existing object or schema causes failure instead of replacement.
Restore then compares every canonical row and every raw body, writable metadata
field, and object tag against the backup.
Successful verification changes the fixture state markers to `verified`.

Run the isolated verification again, then compare the original newer source
against the second backup.
Both commands are read-only.

```bash
pnpm_config_verify_deps_before_run=false heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 -- node services/tools/publisher/scripts/release-paired-backup.mjs verify --directory "$RELEASE_BACKUP_PATH"
pnpm_config_verify_deps_before_run=false heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 -- node services/tools/publisher/scripts/release-paired-backup.mjs verify --source --directory "$RELEASE_NEWER_BACKUP_PATH"
```

Also confirm the newer upload through its canonical source route.
Keep actual identifiers and bodies in private fixture evidence outside Git.

## Limits and remaining proof

Versioned or suspended buckets fail closed because this helper does not export
noncurrent S3 versions or delete markers.
KMS encryption, customer encryption, object lock, and nonstandard storage classes
need a separate recovery procedure.
The helper preserves all writable metadata used by Publisher and object tags.
The source ETag and last-modified values remain evidence in the manifest.
S3 generates new ETag and last-modified values on restore, so those values are
not restore-equality checks.
The helper does not start Tools, run migrations, restore another product's
external service, or claim application-level acceptance.

Parent-owned native proof must cover the successful paired backup and restore,
concurrent source writes and cleanup, pending journal rows with old JSON-string
payloads, saved replacement receipts, refusal of nonempty targets, and the
survival of the original newer upload.
The helper must not be used for an in-place production rollback.

Model the Domain shaped the backup manifest and target ownership markers.
Build the Lever shaped the callable CLI and repeatable raw-byte verification.
Implementation stays in one helper so its snapshot and restore invariants have
one owner.
The parent owns independent review and native fixture integration.

## Implementation checks

Node syntax checks passed for both release scripts.
The real CLI `--help` command passed.
The staged whitespace check passed.
Seven boundary tests cover unsafe configuration, ownership, legacy files,
malformed directories, corrupt backup data, and the callable CLI.
Both attempts were blocked before execution.
The shared `heavy-check` lock remained busy for 600 seconds, then 120 seconds.
Each attempt returned 75.
Run the tests through the same shared lock when it is free.

```bash
pnpm_config_verify_deps_before_run=false heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 -- node --test services/tools/publisher/scripts/release-paired-backup.test.mjs
```

Native backup, restore, concurrency, and newer-source verification were not run
by this implementation delegate.
No fixture process was started.
The parent owns those checks and the independent review.
CI, merge, deployment, and Max's acceptance have not run for this tool.
