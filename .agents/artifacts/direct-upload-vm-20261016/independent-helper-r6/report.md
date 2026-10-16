The HTTP-date backup repair passes its actual runtime check. The full assigned verification result is FAIL because both guarded restores fail their WAL check.

All 10 boundary tests passed. None failed, skipped, or cancelled. Actual preflight passed twice. The actual paired backup completed with all five retained source objects. Separate target verification and source verification passed after the second restore failure. Independent comparisons also passed for all raw bodies, writable metadata, tags, and product database rows.

The restore command did not complete successfully on either fresh target. Neither target was reused or overwritten. Both state markers remain `restoring`. Later successful read-only checks do not change either failed restore result.

The Prove It Works principle shaped this run. The verifier read actual RustFS listing dates and GET dates, copied actual raw bytes to private evidence, ran the source helper, and compared the restored data independently.

Passed checks follow.

- `boundaries.log` records 10 passed boundary tests with zero failures and skips.
- `setup-and-precision.log` records five objects with different listing and GET timestamps. One actual listing date is `2026-10-16T07:47:10.895Z`. Its GET date is `2026-10-16T07:47:10.000Z`. Its raw SHA-256 is `9215b071804711dbfa5365b503ee6845efbc7327bda27e3d37d63cbce0479823`.
- `preflight.log` and `retry-preflight.log` report `releaseReady=true`, no legacy temporary paths, no operations, and no active sessions.
- `paired-backup.log` reports `complete=true` for five objects. The manifest SHA-256 is `629a2cfaf453eb4889cf3a3a9a6a290ed1485b883fb943ec47c6ddfb7132d3e2`.
- `retry-verify-target.log` and `retry-verify-source.log` report successful verification of five objects. Their database manifest SHA-256 is `adab51e121e37286fafa2fcede81b43fd4ba782dc316576bb180dc40c44e517b`.
- `retry-independent-compare.log` reports five exact raw-byte comparisons. Source and target bytes, digests, sizes, writable metadata, tags, and all `tools` and `artifacts` table rows match. The original source also matches its independent pre-backup snapshot, including exact listing milliseconds and ETags.
- The independent check compares each backup body and restored body directly with the retained source bytes. It confirms the full listing timestamp in the manifest. The exact before and after bucket listings match.
- No extra fixture body was needed or added. All five retained objects already expose real subsecond listing precision.
- The application was not started. No source upload, cleanup, or source database mutation was performed. Both backups and comparisons used the retained actual temporary directory. The source was kept quiet.
- Source fingerprints and checksums remained equal before and after both runtime attempts. `source-delta-proof.json` reconstructs the prior source fingerprint by replacing only the helper with its prior bytes. That result matches the prior verifier's exact fingerprint.
- Both shutdowns passed. Ports 45434, 49004, 49005, and 43175 have no listeners. The owned PostgreSQL postmaster PID file is absent. The native stop helper checks storage PID ownership before it sends SIGTERM. No other process was stopped.
- `git diff --check` passed. The isolated checkout has no tracked source changes. No commit was made.

Failed checks follow.

The first restore failed with this exact error in `restore.log`.

```text
Release proof failed: PostgreSQL WAL advanced during verification
+ actual - expected

+ '0/1FBCD50'
- '0/1FBC890'
         ^
```

The documented fallback requires a new token, database, and empty tagged bucket after a failed restore. `retry.py` used that fallback. The first target, source, backup, and previous archives remain retained. No marker or guard was bypassed. The second restore failed with this exact error in `retry-restore.log`.

```text
Release proof failed: PostgreSQL WAL advanced during verification
+ actual - expected

+ '0/24E2FD0'
- '0/24E2B48'
         ^
```

No third restore was attempted. Separate verification and independent comparison ran after the second failure to record the data state. The target markers remained `restoring`, which the independent check explicitly reports as `targetMarkersVerified=false`.

`restore-wal-diagnostic.log` contains the exact first failing WAL interval from the retained native cluster. It contains 16 `Heap2 PRUNE` records for relation files 1259 and 1249 in database 16789, plus one `RUNNING_XACTS` record. These relation identifiers are PostgreSQL catalog identifiers for `pg_class` and `pg_attribute`. The WAL shows catalog maintenance, rather than a product table mutation, in that interval. Attribution to the helper's catalog reads is an inference. No application process ran. No helper source or database setting was changed to suppress the WAL guard.

The optional second WAL diagnostic could not run while it waited for the shared heavy-check lock. Its verified owned waiting process group was stopped. No fixture process was running. `optional-diagnostic-status.json` records that limit. The completed first WAL diagnostic remains available.

One verifier setup error occurred before any fixture process started. The first driver expected unprefixed `S3_ENDPOINT` in the retained environment and raised `KeyError: 'S3_ENDPOINT'`. The native fixture uses `ARTIFACT_S3_*`. The verifier mapping was corrected. `run.first-attempt.py` and `driver.first-attempt.log` retain the error. No application check is counted as passed by that attempt. The private environment file was never printed.

Exact source provenance follows.

- Node version. `v22.23.3`.
- PostgreSQL binaries. `/usr/lib/postgresql/16/bin`.
- RustFS binary. `/home/codex/.local/share/direct-upload-vm-20261016/deps/rustfs`.
- Complete current application source fingerprint. `9569c3bd3d1f2ee085a5260fc56f5d3f2cbb4148b2ebf2af4fddc67270d80594`.
- Prior application source fingerprint with only the helper bytes replaced. `a430b837c6aef31e966eaf708c4f4b1f25a6a2cb4cbd1e456044689779cb17d7`.
- Helper SHA-256. `34d5cbfdff6cc43577b27407517c186a81fe57136993b605558b7af321d6d2fc`.
- Boundary test SHA-256. `417a0f550fe10cfebd01a523a068fd0cba2d2b761507eef7de1acf0f644c36d3`.

The source fingerprint hashes sorted tracked and nonignored source paths, a NUL byte, and raw bytes under `services/tools` and the root package and workspace lock files. Only `release-paired-backup.mjs` differs from the prior verified source. The helper ran directly from source. No test, timeout, application source, primary checkout, or Fleet file changed.

All heavy work used `heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 --lock-timeout 3600`. Each command retained the default timeout. No Docker, credentials from an installed app, sync, production access, deployment, merge, or data deletion ran. The original PostgreSQL options were retained exactly.

```text
-h 127.0.0.1 -p 45434 -c unix_socket_directories=''
```

The public verification artifacts are in `.agents/artifacts/helper-http-date-r6`. The runtime drivers are `run.py`, `retry.py`, and `inspect.mjs`. The first-attempt inspection script is retained as `inspect.initial.mjs`. `status.json` and `retry-status.json` record each command result. The driver exit code alone is not the verdict. The retry driver reaches shutdown normally while its explicit execution verdict remains `fail`.

Private exact evidence remains in `/dev/shm/direct-upload-final-verifier-20261016`. `r6-backup` holds the complete paired backup. `r6-independent` holds raw source and target bytes and full row, metadata, tag, date, and ETag snapshots. Both restore databases and buckets remain in the owned native fixture. Fake fixture credentials, owner records, sentinels, previous bodies, replacement receipts, and earlier archives remain retained.

All durable archives use mode 0600. Their directory is `/home/codex/.local/share/direct-upload-vm-20261016/final-native-verifier`.

- `helper-http-date-r6-pre-stop-fixture.tar`. 106373120 bytes. SHA-256 `11b33ccc2ae4d02b19f5ff5c86b672ace6a875e78bbdb0293e1bd94ed69b59b9`.
- `helper-http-date-r6-stopped-fixture.tar`. 106455040 bytes. SHA-256 `1cf5fd09ee784ee541108a9d5779f1a775745691e113acfe601fc3cdc5713ea1`. All 2908 regular archive files matched the retained fixture at that shutdown.
- `helper-http-date-r6-retry-pre-stop-fixture.tar`. 133744640 bytes. SHA-256 `a6813a9cd769b58a952bea449fb42518d47b0d135565af332e13ffeec70199a2`.
- `helper-http-date-r6-retry-stopped-fixture.tar`. 133980160 bytes. SHA-256 `e41e9896fa5a5f9543f3a23feeb3a03e05e6e1d0e6463b9f02497ddffcabd40d`. All 3389 regular archive files matched the final retained fixture byte for byte.

The pre-stop archives completed before each shutdown. The stopped archives preserve the complete stopped cluster and native object-storage data. The archive evidence is durable outside tmpfs.

Local checks passed for boundary tests, preflight, paired backup, separate target verification, source verification, and independent raw comparisons. Both actual restore commands failed. The full assigned runtime verdict is FAIL.

CI was not run or inspected. Source review belongs to the parent and its separate reviewers. No PR or merge work ran. Production and installed rollout acceptance were not attempted. Max's acceptance remains open. The prior 26 integration tests, build, and CLI checks were not rerun because their application source is unchanged. The parent owns the separate newer-upload, legacy-chunk, and application-restart proof.

The parent owns the open decision on the restore WAL guard. The next action is to review the retained failure and catalog WAL evidence before any complete paired-restore acceptance claim. This verifier has no pending child work.

Dispatch ledger. In-thread verification used the assigned private fixture. No subagent was spawned.
