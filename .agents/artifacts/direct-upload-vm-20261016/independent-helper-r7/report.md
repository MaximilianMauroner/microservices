The R7 release helper verification result is PASS.

The actual fresh paired backup and actual fresh restore both exited with code 0. Both separate target verification commands and verify --source exited with code 0. The independent comparison exited with code 0. Both target completion markers are verified. This verdict comes from this fixture and these command results. It does not rely on the parent's separate fixture.

All 10 boundary tests passed. Zero tests failed, skipped, or were cancelled. Actual preflight reported releaseReady=true, no legacy paths, no operations, and no active sessions. The helper ran directly from its changed source with Node v22.23.3. No application process was needed or started.

The new runtime driver is run.py. The independent verifier is inspect.mjs. The final retained-data check is finalize.py. status.json records every actual command exit code. driver.log records the shared heavy-check lock and driver results. finalize.log records the separate final validation and shared lock. Both outer heavy-check commands exited with code 0. No application source, tests, source helper, primary checkout, or Fleet file was changed. The only new repository files belong to this evidence directory. Git status was empty before and after. git diff --check passed.

The command used the shared lock with these exact arguments.

```text
heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 --lock-timeout 3600 -- python3 .agents/artifacts/helper-logical-r7/run.py
```

The same lock arguments preceded finalize.py. Heavy operations ran one at a time. Default command timeouts were retained. The host had 2,151 MiB available memory and 231 GiB free durable disk before setup. The four owned ports were free. Memory and disk remained sufficient through shutdown.

The retained PostgreSQL 16 cluster restarted with its saved settings. The exact pg_ctl option string was the following.

```text
-h 127.0.0.1 -p 45434 -c unix_socket_directories=''
```

The driver read the retained fixture environment privately. RustFS restarted with its retained bodies on ports 49004 and 49005. No fresh-start command ran over the existing state. Setup created a new owner-token database with the disposable sentinel and a new empty bucket with matching owner and state tags. The target used the required tools-release-restore-${OWNER} name. The owner value and exact target names remain private. Neither failed R6 target was reused.

The new private backup is /dev/shm/direct-upload-final-verifier-20261016/r7-backup. The new independent raw evidence is r7-independent under the same private state directory. Exact environment values are in r7-release-environment.json in that directory. These private files were not copied into repository evidence.

The independent comparison passed for all five objects and all 179 rows across 28 tools and artifacts tables. It compared source, backup, and target raw bodies byte for byte and by SHA-256. It compared sizes, every present writable metadata field, exact object tags, and complete rows. It also parsed database.json independently and compared it to the source rows. database-after.json equals database.json. The backup bucket-before.json and bucket-after.json are equal.

All five object tag sets were empty and remained empty. Present writable metadata fields were ContentType, CacheControl, ContentDisposition, and Metadata. Fields absent in these bodies were also absent in the compared records. This fixture does not prove preservation of nonempty object tags or metadata values that it does not contain.

Every source body and full source inventory matches the retained R6 source-before snapshot. This includes exact listing milliseconds, GET timestamps, ETags, sizes, metadata, tags, and complete rows. The new before and after snapshots also match exactly. No source upload, cleanup, or source product database write ran. Target creation and restore wrote only the fresh isolated target. PostgreSQL physical maintenance is outside the logical equality claim.

All five objects have subsecond listing timestamps and second-resolution GET timestamps. The independent check verifies the GET timestamp equals the listing timestamp rounded down to whole seconds. The full unrounded listing timestamp remains in the backup manifest. independent-summary.json retains every body hash, byte count, both timestamps, metadata field names, tag count, and table row counts without object keys or capability IDs.

One example has listing time 2026-10-16T07:47:10.895Z and GET time 2026-10-16T07:47:10.000Z. Its raw body SHA-256 is 9215b071804711dbfa5365b503ee6845efbc7327bda27e3d37d63cbce0479823.

The new manifest SHA-256 is a15896e91bed9ba0fee2a8e8da36433a0aa52feed4c2aafe5c41be6ab42059b6. Its database manifest SHA-256 is adab51e121e37286fafa2fcede81b43fd4ba782dc316576bb180dc40c44e517b. The manifest records the quiet-source precondition and two full bucket reads. The independent verifier requires both the database sentinel and bucket state tag to be verified.

Source provenance passed before and after the actual run.

- Application source fingerprint. 81172b361df7e14a09818ef9352270e3ac203aec2ce1dcf60aa9cacf72100fac.
- Release helper SHA-256. 1483cebb4cbd0271c79dfb9f385fc0e2d20217e81f5df3d6bcdc55be943059b3.
- Boundary test SHA-256. 417a0f550fe10cfebd01a523a068fd0cba2d2b761507eef7de1acf0f644c36d3.
- R6 source fingerprint with only helper bytes replaced. 9569c3bd3d1f2ee085a5260fc56f5d3f2cbb4148b2ebf2af4fddc67270d80594.
- Earlier runtime source fingerprint with only helper bytes replaced. a430b837c6aef31e966eaf708c4f4b1f25a6a2cb4cbd1e456044689779cb17d7.

source-delta-proof.json records the exact source delta. Only release-paired-backup.mjs differs from the earlier verified application source. Since R6, that delta removes physical WAL position reads, comparisons, and manifest fields. Target verification now compares the complete logical row inventory before and after the bucket checks. The existing logical backup comparison remains. The earlier HTTP-date precision repair remains.

The source fingerprint hashes sorted tracked and nonignored source paths, a NUL byte, and raw file bytes under services/tools plus the root package and workspace lock files. The helper and test checksums are identical before and after execution.

The retained build identifies a430b837c6aef31e966eaf708c4f4b1f25a6a2cb4cbd1e456044689779cb17d7 as its source. Final validation compared every actual .output file against the earlier independent build-manifest.json and required the exact same file set. All 327 files match. Its tree SHA-256 is bbf8c426e66478fffeee9b3c50f2e848dc24a432b40aa586fbca434198b1cc1a. The current helper is run from source and is not supplied by this earlier build. The driver's build-before and build-after fields scan dist and find zero files. Those fields do not measure .output. The complete .output claim comes from the retained earlier manifest and the actual final comparison in final-validation.json.

No R7 backup or restore attempt failed. No restore retry or fallback was required. R6 recorded two actual restore failures with PostgreSQL WAL advanced during verification. Its retained WAL evidence and logical-backup-guard-r7/decision.md explain the changed guard. R7 does not alter those earlier failure records or count their later read-only checks as successful restores. No guard, test, source, or timeout was changed for this run.

Both source and target final pg_dump commands exited with code 0. The pre-stop private archive completed before fixture shutdown. The owned stop helper exited with code 0. It checks storage PID ownership before SIGTERM and stops only the retained PostgreSQL cluster through pg_ctl. The postmaster PID file is absent. Both exact owned PIDs are inactive. final-validation.json records their numeric IDs. No listeners remain on ports 45434, 49004, 49005, or 43175.

Durable private archives remain under /home/codex/.local/share/direct-upload-vm-20261016/final-native-verifier. Both new archives have mode 0600.

- helper-logical-r7-pre-stop-fixture.tar. 144844800 bytes. SHA-256 8f1cb324b5455f0e8a407f940a0a4d83060c3bbffdb4853ca8ef6f949158e715.
- helper-logical-r7-stopped-fixture.tar. 145039360 bytes. SHA-256 6cd0106ee3c3e9420a4e3f3debb09a54e8dcf8db759491c8217b15a8d514757d.

The stopped archive contains 3,883 regular files. Every regular archive file matched its retained fixture file byte for byte after shutdown. This includes prior bodies, source inputs, backups, receipts, and private fixture records. The earlier backup and target state remains retained. Final validation also rehashed all four R6 durable archives and matched their recorded hashes. All earlier durable archives remain present. No data or archive was deleted.

Local checks passed for boundaries, preflight, backup, fresh restore, both target verifications, source verification, independent comparison, source and target final dumps, source provenance, retained build comparison, archive comparison, and shutdown. CI was not run or inspected. Source review belongs to the parent. No PR, push, merge, production access, deployment, installed credentials, browser acceptance, or rollout check ran. Max's acceptance remains open. The earlier 26 integration tests and five operations were not rerun because the application runtime and CLI source are unchanged. The parent's separate deeper paired proof was not repeated.

The Prove It Works principle changed the verification choice. This run used the actual helper exit codes and independent native PostgreSQL and RustFS reads. It did not infer success from the parent's result or from compilation.

No verification decision remains open in this lane. The parent owns review of this evidence and the combined task verdict. Max owns acceptance. The next action is for the parent to copy the selected redacted evidence. All owned processes are stopped. This task has no delegates or pending child runs.

Dispatch ledger. In-thread verification used the assigned isolated checkout and private retained fixture. No subagent was spawned.
