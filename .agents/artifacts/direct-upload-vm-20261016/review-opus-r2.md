I reviewed both repositories against the interrogate rubric. Neither has a critical defect in the reviewed scope.

- **Microservices:** the runtime fixes and the completion digest guard are correct. The backup helper has four warnings. Most important: its new production mode cannot complete a production backup as written.
- **Fleet:** the sha256-on-complete fix closes the defect Sol found. The other findings are evidence gaps.

I changed no file, started no process and made no production call. Another agent is writing in both worktrees now. `interface.md`, `destinations.json` and the final logs changed during this review, so I reviewed the state as it was at about 05:51 UTC.

## Microservices

**Scope:** working edits since e8329c3, plus all of `release-paired-backup.mjs` (ca46c4f and working edits).

**Verdict:** the fixes are correct. Not ready for release. The backup helper's production mode needs another pass.

The three accepted fixes from review-opus-r1 are in place:
- **Omitted project:** an update with no project now reaches the commit as null, and the commit keeps the current project.
- **Cleanup order:** sessions that are not yet cleaned are processed first.
- **Ambiguous old journal:** the row, payload and body are kept, and other recovery work continues.

The completion digest guard runs before the insert or pointer commit. It also runs on the duplicate reply. A mismatch returns 409 without marking the session failed, and the same UUID can retry with the original source.

### 1. [Warning] Production backup cannot succeed against live Tools
**Location**: `release-paired-backup.mjs:106-121` (`databaseState`), `:310` (`pg_dump --schema=tools --schema=artifacts`), `:330-333` (equality and WAL checks)
**Finding**: The backup compares every `tools` and `artifacts` row before and after the copy. It also requires the WAL position of the whole cluster to stay the same.
**Evidence**:
- The `tools` schema holds monitoring and finance tables (`postgres-schema.ts:23-370`).
- The schema gets writes that have nothing to do with uploads:
  - `src/routes/api/status/heartbeats/$monitorId.ts` writes when an external service sends a heartbeat.
  - `src/scheduled-task-leases.ts:48,67` writes `tools.scheduled_task_runs` on every scheduler run.
- Max pausing his uploads does not stop these writers. Every production backup fails with "Concurrent database writes" or "WAL advanced".
- The backup also copies all `money_*` data to local disk, which a Publisher release does not need.
- The guards fail closed. The result is no usable production backup, not a false pass.

**Suggestion**: Limit `databaseState`, `pg_dump` and the restore comparison to the `artifacts` schema. Keep the WAL guard only for loopback fixtures. The artifacts row comparison already detects concurrent changes.

### 2. [Warning] Production preflight can report `releaseReady: true` from the wrong machine
**Location**: `release-paired-backup.mjs:129-174, 278-290`
**Finding**: With `--production-source`, the legacy chunk check still reads only local `--tmpdir` paths.
**Evidence**:
- The legacy chunk directories are on the Railway container's disk.
- If you run preflight from the VM or the Mac with an empty local directory, `legacy` is `[]`.
- Nothing records or checks which host the directories belong to.
- The brief makes the drain proof a release precondition.

**Suggestion**: In production mode, require `process.env.RAILWAY_SERVICE_ID === RELEASE_SOURCE_SERVICE_ID` (and the matching environment ID) before you accept a tmpdir inventory. Also record the hostname in the report. Otherwise, refuse `--tmpdir` in production mode and report the drain as not checked.

### 3. [Warning] The two database clients apply the TLS policy differently
**Location**: `release-paired-backup.mjs:71-72, 88, 250`
**Finding**:
- `sslmode=require` is accepted. Both postgres.js (`connection.js:283`, `rejectUnauthorized = false`) and libpq then use TLS without checking the server certificate, so production credentials and data can go to a man in the middle.
- The default `verify-full` works in postgres.js, which uses the system trust store. libpq's `pg_dump` needs `~/.postgresql/root.crt` or `sslrootcert=system`.

**Evidence**: Preflight can pass and the backup can then fail at `pg_dump` with no clear cause.
**Suggestion**: Accept only `verify-full`. Pass the same root-certificate source to both clients, for example with `PGSSLROOTCERT=system` for `pg_dump`.

### 4. [Warning] A kept ambiguous journal row blocks release preflight permanently
**Location**: `postgres-storage.ts:338-341`, `release-paired-backup.mjs:125,286`
**Finding**: The accepted fix keeps the `legacy_base_missing` row and renews its 6-hour lease. Preflight requires `operations === 0`.
**Evidence**:
- If production has one such row, `releaseReady` can never become true.
- The only way out is a manual production DB delete, and no procedure or decision covers it.
- `pending()` cannot tell this row apart from a live operation.

**Suggestion**: Report kept-for-evidence rows separately in preflight. Record an owner decision on how such a row is resolved before release.

### 5. [Nit] The legacy replace response depends on a second read after the commit
**Location**: `fetch-app.ts:1095-1099`
**Finding**: The project in the response now comes from `getHtml(headOnly)` after a successful commit.
**Evidence**:
- If that read fails (for example an S3 HEAD error), a committed replacement returns 500.
- The installed multipart Fleet client, still on all 12 destinations, retries once after HTTP 500 `internal_server_error`. That adds a second, identical version and receipt.

**Suggestion**: Have `putHtml` return `receipt.after.project`. The rationale says this would need an interface change outside the assigned files. That is not a design reason.

### 6. [Nit] The browser hashes the whole file in JavaScript
**Location**: `ui/direct-upload.ts:97,119-134`, `package.json` (`@noble/hashes`)
**Finding**:
- When the session is still uploading, the browser now reads the file twice: once for the part hashes and once for the whole-file hash.
- `@noble/hashes` is a new third-party dependency. Its entry is also out of alphabetical order.
- There is no browser test for the response-digest mismatch or the 409 path.

**Suggestion (optional)**: Send the part digest list on complete and compare it with `session.parts`, which `verify` already checks against the stored bytes. The browser could then use native `crypto.subtle` for each part. Keep the whole-file check in Fleet and the TS script.

### 7. [Nit] The fetch-app test copies the behavior it checks
**Location**: `fetch-app.test.ts:31-33`
**Finding**: The memory storage mock now reproduces the server's `coalesce` rule, so the unit test partly checks its own mock. The real Postgres integration test is the actual evidence.

## Fleet

**Scope:** full diff from `origin/main` through the working tree.

**Verdict:** no correctness findings.
- `upload.py` sends the source digest, computed before the upload, on every complete. That closes the same-size changed-source path for sessions in the "completing" and "completed" states.
- Changed parts in the "uploading" state are still rejected when parts are signed.
- An old server ignores the complete body and rejects or does not echo `replaceId`, so the order of server first, then client, is safe.
- Scoped `--skill` delivery is limited to the selected skill and its links, checks the controller identity, and rolls back on failure.

## Gaps in the decision trail

- **Microservices `decisions.tsv`:**
  - The last row still says "server guard and real recovery check pending".
  - `resources-final.log`, `live-cli-final.log` and `verify-final.log` contain only the heavy-check lock wait line, so there is no result yet.
  - No row records adding the production read mode, or who approved reading production data under a brief that says "do not touch production data".
  - Findings 6 to 9 from review-opus-r1 have no accept or reject row. Finding 6 is only partly applied: `DIRECT_PART_BYTES` is imported, but `audience: 'native'` is still hardcoded for browser legacy replaces.
- **Microservices `interface.md`:**
  - The committed text says "This implementation has no production mode".
  - The uncommitted edit adds production mode, but no native proof of production-shaped behavior exists.
  - `paired-proof-result.json` does not exist.
- **Fleet `status.md`:** it is out of date.
  - It still says 29 tests; `completion-hash-tests.log` shows 30 passed.
  - Its desired script hash is `195dfade…`. The working `upload.py` is `f5566e1e…`, which matches the uncommitted `destinations.json`.
  - It still says independent review has not run.
- **Fleet evidence logs:**
  - `final-checks.log` contains only a lock wait line and "ok", with no command.
  - Fleet has no decision log entry for the sha256-on-complete change.
- **Fleet `release.md`:** it does not say that the source-changed guard works only after the server is deployed. Before that, a new client depends only on checking the response, which is the gap Sol found.

## Open decisions

| Decision | Owner |
|---|---|
| Limit the backup to `artifacts` and the WAL guard to fixtures (findings 1 and 3) | Parent implementer |
| Prove the production drain from inside the container (finding 2) | Parent implementer |
| How to resolve kept ambiguous journal rows before release (finding 4) | Max |
| Who approved production read access for the backup | Parent records it; Max approves |
| Close the evidence gaps above | Parent implementer |

**Next action:** the parent fixes or rejects findings 1 to 4 and records each one in `decisions.tsv`. Then the parent waits for the final resource, live CLI and verify runs and records their results.
