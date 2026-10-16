## Review: 84681eb..816f830, `services/tools/publisher/scripts/release-paired-backup.mjs`

**Result: no critical or warning findings.** I found three nits. The delta does not add a correctness fault. The remaining exposure comes from the documented quiet-source precondition, not from this change.

### What I checked

**1. Backup path (`release-paired-backup.mjs:327-372`).** The paired copy stays consistent without the WAL guard. Each way that a writer could make the database and bucket disagree is still caught by a check that remains:

- `database.json` and `pg_dump` share one exported snapshot (`:338`, `:345-346`).
- `references()` (`:355`) fails if any live canonical row at the snapshot has no matching body.
- A body that is deleted or replaced during the reads changes the listing. The three-way listing equality at `:351` and `:354` catches it, and the second hash read at `:353` also catches it.
- A row that a writer commits after the snapshot shows up in `databaseAfter` (`:362-365`), unless the writer changes it back before that read.
- A body uploaded between the snapshot and the first listing, whose row commits later, is a captured orphan body. That is a valid recovery state.

The WAL guard only ever added detection of change-and-revert (ABA) rows inside the window. Because the dump is snapshot-based, an ABA row cannot make the paired copy inconsistent. It can only hide that the source was not quiet, and the quiet-source precondition already covers that. `decision.md` states this limit correctly.

**2. Production path.** No change. The WAL calls were already skipped when `productionSource` was set (the removed lines `config.productionSource ? undefined : await wal(sql)`). Production stability checks still compare only `artifacts.*` (`stableDatabase`, `:308-310`). This is intentional and documented.

**3. Verification path (`:431-441`).** For a restore target, `scope` is the identity, so both reads compare every table. For local `--source`, `stableDatabase` is also the identity, because `productionSource` is false. For production `--source`, both reads compare `artifacts.*` only. The second read at `:439` runs in a new read-only repeatable-read transaction after the second bucket listing, so it is a real stability check. The restore connection is read-write (`:446`), but `begin('… read only')` keeps these reads read-only. Source helpers still connect with `default_transaction_read_only: on` (`:101`).

**4. Row scope.** `databaseState` reads only relkind `r` and `p` in `tools` and `artifacts`. I searched the Drizzle schema (`services/tools/database/postgres-schema.ts`, `pgSchema("tools")` and `pgSchema("artifacts")`). It has no `serial`, identity, `pgSequence`, `pgView`, or `pgMaterializedView`. The claim in `decision.md` that there are no sequences holds.

**5. Callers of the removed fields.** A grep for `startWal`, `endWal`, `pg_current_wal`, and `WAL advanced` over source, tests, and docs finds no reader. `loadBackup` (`:374-395`) never read these fields, so older manifests still load.

**6. Concurrent-writer proof (`paired-proof.mjs`).** The writer is monotonic: `generation + 1` every 10 ms on a `tools.*` marker table. This makes an ABA revert impossible, so `databaseAfter` must differ and the logical guard rejects the backup. The logical check already ran before the old WAL check, so this proof already exercised it.

**7. Diagnostic evidence.** `wal-source-final-diagnostic.log` shows 12 `Heap2 PRUNE` records with `tx: 0` on relation 2619 (`pg_statistic`). This supports the stated root cause: physical WAL moves without any product DML.

## Findings

### 1. [nit] The proof still accepts a rejection message that no longer exists
**Location**: `.agents/artifacts/direct-upload-vm-20261016/paired-proof.mjs`, the `assert.rejects(() => backup(config, [tmpdir], invalid), /Concurrent database|WAL advanced/)` call near the end.
**Finding**: Nothing can produce the `WAL advanced` text after this delta.
**Evidence**: A grep for `WAL advanced` finds no producer in the helper. The extra alternative only widens what the proof accepts.
**Suggestion**: Match `/Concurrent database writes or cleanup invalidated the backup/` exactly. Then the proof shows that the logical guard is what fired.

### 2. [nit] The committed operator doc still describes the WAL guard
**Location**: `.agents/artifacts/direct-upload-release-proof-vm-20261016/interface.md` at HEAD, lines 85 and 99.
**Finding**: At 816f830 the doc still says that `manifest.json` holds "WAL positions" and that "An advanced PostgreSQL WAL position rejects the backup".
**Evidence**: The working-tree edit corrects both statements, but it is not committed. It also contains earlier production-source text that has not been committed since `ca46c4f`. If the parent does not commit it, the committed doc contradicts the code.
**Suggestion**: The parent commits the `interface.md` edit with this fix.

### 3. [nit] The new verification-time database check is not exercised by any proof
**Location**: `release-paired-backup.mjs:439`
**Finding**: No test or proof step mutates a row during `verify` or `restore`. The message "The database changed during verification" is never observed firing.
**Evidence**: `release-paired-backup.test.mjs` has no database fixture. `paired-proof.mjs` only exercises the backup-time guard. The risk is low because `:439` uses the same `equal(await database(), scope(stored.database), …)` expression that the first read at `:434` already proves on the success path.
**Suggestion**: Optional. Do not add a test that only restates the implementation.

### Considered and dismissed
- **The `scope` and `database` closures in `verifyRestored` are slop.** Dismissed. They remove a long expression that would otherwise appear twice, and they live inside the function. The `source ? stableDatabase(…) : state` ternary could become `stableDatabase(state, config)`, because restore configs can never set `productionSource` (`:44`). But that would loosen the exported `verify(prodConfig, dir)` call without `source` from a full comparison to an artifacts-only comparison. The ternary was already there before this delta, so I do not recommend the change.
- **ABA writers and transactions that commit after the final read.** These are documented limits of the quiet-source precondition. The manifest records `requiresQuiescentSource: true` and `atomicBucketSnapshot: false`. As traced in point 1, they do not create a database/bucket inconsistency in the captured copy.
- **DDL during the window.** This is outside the delta. The dump uses the exported snapshot, `pg_dump` takes ACCESS SHARE locks, and the quiet-source precondition applies.
- **The two-journal case.** Not reopened, as instructed.

## Status
- **Local checks**: none run, as instructed. This was a read-only review.
- **Actual paired proof**: owned by the parent and still running. The earlier rule stands: do not claim a pass for the paired backup and restore until that run completes, both restore markers reach `verified`, and `concurrentWritesInvalidateBackup` passes.
- **CI, merge, and Max's acceptance**: not inspected. They remain open.

**Open decisions**: the parent decides whether to fix nits 1 and 2 before committing. **Next action**: the parent finishes the actual paired proof and saves this review.
