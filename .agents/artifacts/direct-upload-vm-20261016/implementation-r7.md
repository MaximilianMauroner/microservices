I replaced both WAL position checks with full logical database comparisons, in commit `c3423dd`. A quiet source and a fresh restore target no longer fail because of maintenance WAL. A concurrent writer to the `tools` or `artifacts` schemas still fails the backup and the verification.

I have no queued or running command, so I stopped nothing. My one heavy-check run finished before your message.

**Cause.** The old guard assumed that if the WAL position moves, the product data changed. That is false. In all three failed intervals, every WAL record had no transaction ID (`tx: 0`), so none of them was a product write.
- **Source backup.** 12 `PRUNE` records on `pg_statistic`.
- **Earlier source backup.** `PRUNE` records on `upload_sessions`.
- **Restore verification.** `PRUNE` records on `pg_class` and `pg_attribute`, and one `RUNNING_XACTS` record.

The WAL position counts activity in all databases of the cluster, and the restore targets share the source cluster. Ordinary reads prune pages, so the helper's own scans could move the position.

**Diff.** Only `services/tools/publisher/scripts/release-paired-backup.mjs` changed.
- I deleted the `wal()` function.
- `backup` no longer records `startWal` or `endWal` and does not compare them. Its existing full comparison against `database-after.json` already ran after both bucket reads, so that check now does the work alone.
- `verifyRestored` reads the database again after its second bucket listing. It compares that read with the same expected rows. If they differ, it fails with `The database changed during verification`. Production `--source` still compares only the `artifacts` rows.
- The note `.agents/artifacts/logical-backup-guard-r7/decision.md` records the premise check and the options I rejected. `.agents/artifacts` is gitignored, so I force-added it, the same way the other tracked artifacts were added.
- I did not change the boundary test file. Any test I could add without PostgreSQL would only restate the implementation.

**Options I rejected.**
- **Filtered WAL through `pg_walinspect`.** It needs a new extension and higher privileges, and managed production PostgreSQL does not support it. It also depends on relfilenode maps that table rewrites break.
- **Comparing transaction ID counters.** The counter is cluster-wide, and autovacuum `ANALYZE` takes transaction IDs when it writes `pg_statistic`. The result would depend on autovacuum timing.

**Checks.**
- `node --check` passed.
- The 10 boundary tests passed in my worktree, run through the primary `heavy-check` lock with the parent's dependencies, read-only. I removed the temporary dependency symlink afterwards.
- `git diff --check` passed. My worktree is clean, and the primary status is the same as at the start.
- Runtime on PG16 and RustFS: I did not run it. You report the full paired proof passed, from `paired-proof-result.json` and `paired-logical-guard.log`. I have not read those files.
- Independent review: you say it is still running. CI, merge and Max's acceptance are not started.

**Limits.**
- The logical comparison cannot see a writer that changes a row and then puts the same content back inside the backup window. Only the fixture WAL guard could catch that. The database side does not depend on it, because the dump and `database.json` come from one exported snapshot. `references()` still checks directly that every live canonical row has its body with the correct size and digest.
- The comparison also cannot see a transaction that starts before the snapshot and commits after the final read. Any body that such a writer leaves in the bucket is captured as an orphan, which is a valid state to restore. The active-session block and the quiet-source precondition cover this case.
- The comparison covers tables only. The `tools` and `artifacts` schemas have no sequences.
- New manifests no longer contain `startWal` and `endWal`. No reader uses these fields, so old backups still load.

**Principles.** Attack the Premise made me test the WAL assumption against the decoded records before I chose a fix. Fix Root Causes made me remove the guard itself, not add a `VACUUM` or a wait for quiet. The Laziness Protocol kept the fix to the existing `databaseState` comparison, with no new abstraction.

**Open decisions.**
- `interface.md` still describes WAL positions at line 103 and the WAL guard at lines 124 to 128. You own that update.
- You own the decision to accept these limits after the independent review.

Next action: you run the independent real-helper verifier.

**Dispatch ledger.** In-thread, because the brief forbids nested children.
