# Delegated result register

Read back from T3 task_status on 2026-10-16. Later rounds supersede earlier findings.

## skills-portability-20261016-r1

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-skills-portability-20261016-r1

Status completed. Pending child runs false.

Committed `6c8683376029f58c1b45e755582a015309a8511d`. Worktree is clean.

Fixed PostgreSQL socket-path portability and full-command PID checks. Removed Mac launch paths. Updated Publisher P4 for direct create, replacement, recovery, and integrity checks. Added PDF viewing and download checks. Removed stale MinIO endpoint claims.

Changed files:

- `.agents/skills/verify-tools/SKILL.md`
- `.agents/skills/verify-tools/features/publisher.md`
- `.agents/skills/verify-tools/scripts/native-fixtures.py`
- `.agents/skills/verify-network-console/SKILL.md`
- `.agents/skills/verify-network-console/features/dashboard.md`
- `.agents/artifacts/[fixture-capability-redacted]/handoff.md`

Passed syntax, help, both skill validators, local links, PostgreSQL config parsing, whitespace, and scoped deslop checks.

PostgreSQL 16.15 is installed. No native S3 binary was found. Exact download, checksum, startup, and stop commands are in the [handoff](/home/codex/.t3/worktrees/microservices/direct-upload-native-skills-vm-20261016/.agents/artifacts/[fixture-capability-redacted]/handoff.md).

Fixtures and browser checks were unrun by instruction. Auth blockers remain. CI is unrun. Independent review belongs to the parent. No PR, merge, deployment, or production change occurred. Max acceptance is pending.

Model the Domain preserved the existing fixture state. Laziness Protocol kept the Python change small.

No open product decisions. Parent’s next action is cherry-pick, live verification, and independent review.

Dispatch ledger. In-thread implementation and validation under the parent’s brief.

## release-proof-20261016-r1

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-release-proof-20261016-r1

Status failed. Pending child runs false.

The provider could not start this turn. Retry the turn; if it keeps failing, check the provider setup and server logs.

## no-comments-ms-20261016-r1

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-no-comments-ms-20261016-r1

Status completed. Pending child runs false.

No-comments verdict: **PASS** for the scoped diff from `origin/main` through HEAD and the working tree.

- Files changed by this review: none.
- Comment deletions required: 0.
- `MUST KILL` symbols: none.
- Kept: executable shebangs and `native-fixtures.py`’s module docstring, which supplies CLI help through `ArgumentParser(description=__doc__)`.
- Skipped: unchanged comments, docs/artifacts, other file types, application correctness review, and heavy checks.

Next action: parent owns the independent application review. No open comment decisions.

## opus-app-review-20261016-r1

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-opus-app-review-20261016-r1

Status completed. Pending child runs false.

## Findings

I found no critical defects. I traced the direct create and replace paths, the conditional commit, legacy multipart replacement, journal recovery, revoke and delete, cleanup, PDF delivery, the browser and TS clients, and the live proof scripts. I changed no files and started no processes. The live CLI proof has not run yet: there is no `.output` build and no `live-cli-result.json`. So nothing below relies on live evidence.

### 1. [Warning] A legacy replacement can undo a newer project edit
**Location**: `services/tools/publisher/src/fetch-app.ts:1062` (`project ??= existing.project`), then `html-versions.ts:469` (`project = coalesce(${body.project}, project)`)
**Finding**: The legacy `PUT /api/uploads/:id` and `PUT /api/external-uploads/:id` routes fill in the project from the headOnly read before staging. Then `commitHtmlVersion` writes that stale value. The `coalesce` does not help, because the payload project is never null.
**Evidence**: The path runs read (project A), then stage, hash and full read-back, then `finalizePut`. If `updateHtmlProject(id, B)` runs during that window, it does not change `object_key`, so the expected-key check passes and the commit sets the project back to A. The same thing happens when a crashed new-format legacy operation is recovered after a project edit, because recovery skips the `updated_at` staleness check when `expectedObjectKey` is set. The integration test at `direct-uploads.integration.test.ts:202` covers only old journals without `expectedObjectKey`. The brief says project changes must not clobber.
**Suggestion**: Pass only `staged.project` to `putHtml` in update mode, so an omitted project reaches the commit as null. Build the response project from `receipt.after.project`, or from a fresh read.

### 2. [Warning] Browser Replace can get stuck on a failed or expired session
**Location**: `services/tools/publisher/ui/direct-upload.ts:57,102-111`; this behavior is locked in by `test/direct-upload-client.test.ts` ("keeps the same request UUID when an expired replacement is retried")
**Finding**: A replacement keeps its saved request ID after any failure that is not a cancel. When `complete` returns 409 `replace_conflict`, the server marks the session `failed` (`direct-uploads.ts:213`). Every later Replace with the same file in that tab then sends the same ID and gets 404 from `active()`. `sessionStorage` survives a reload, so the user must open a new tab or change the file.
**Evidence**: A 404 on replacement init can only mean the session never committed, or the target was revoked. Completed replacement sessions skip the expiry check (`direct-uploads.ts:57`) and are never pruned (`:263`). If the target was revoked, a new ID fails anyway at `lockHtmlVersion`. So keeping the ID gives no protection against a double replace. It only blocks the user.
**Suggestion**: Keep the rule of no automatic new UUID inside one attempt. But when a replacement fails with 404 or `replace_conflict`, call `removeSavedId(savedKey)` before rethrowing, so the user's next click starts fresh. Change the test to match.

### 3. [Warning] Cleanup keeps reprocessing cleaned replacement sessions and can starve other cleanup
**Location**: `services/tools/publisher/src/direct-uploads.ts:237`
**Finding**: `(s.cleaned_at is null or (s.target_id is not null and s.expires_at > now() - interval '1 day'))` selects aborted, failed or expired replacement sessions that are already cleaned, on every sweep, until one day after expiry.
**Evidence**: `cleanup()` runs before every session create (`direct-upload-request.ts:42`) and in hourly retention. Each reselected row takes the session lock, runs two UPDATEs and an `objects` lookup, then S3 list-uploads and delete calls on the create request path. With `order by s.expires_at limit 20`, twenty such rows hide newer uncleaned sessions for up to a day. The retry gives nothing: a failed `removeUnpublished` already leaves `cleaned_at` null, and complete, abort and cleanup are serialized by the session advisory lock. After an abort, no path can create the key again.
**Suggestion**: Remove the `or (target_id … 1 day)` branch. If a retry for revoked targets must stay, order uncleaned rows first and make the retry bounded.

### 4. [Warning] One unrecoverable journal row blocks every Publisher request
**Location**: `services/tools/publisher/src/postgres-storage.ts:338-340`, called from `reconcileArtifactOperations` (`:310-319`)
**Finding**: The new branch `throw new Error("Legacy artifact operation needs an explicit recovery decision")` runs inside the shared recovery loop. That loop runs first in `getHtml`, `getTemporaryFile`, `listUploads`, `putHtml`, `deleteUpload`, and the other entry points. The row is never deleted, so every later request throws, and the loop never reaches the operations after it.
**Evidence**: Here is a concrete source. Old code ran an in-place replacement of a direct-created page (key `transfers/<id>`), and the process crashed. The artifact was then deleted under old code, which removed the row. After the 6-hour lease expires, new code finds `current` null and a non-standard `objectKey`, and throws on every request. Before tombstones existed, a missing row means the artifact was deleted, so finalizing would bring it back.
**Suggestion**: Delete the operation and log a structured event, the same as the stale branch at `:334-336`. That keeps the no-resurrect rule without an outage. At a minimum, catch the error per operation so one bad row does not stop every request.

### 5. [Warning] The live proof can report passes that it did not prove
**Location**: `.agents/artifacts/direct-upload-vm-20261016/live-cli.py:105-111,133,159-165`, `observe.py:39-49`, `inspect.mjs:14-18`
**Finding**: The script has four false-pass risks.
- (a) After a faulted run, the script never checks that the fault fired. It writes `lostInitializationResponse` and `lostCompletionResponse` as hardcoded `"passed"`. If the CLI never sent a request the proxy matched, the control file stays armed and drops a request in a later, unrelated run.
- (b) There is no `try/finally`. On any assertion failure, the proxy (43171) and app (43173) keep running. On a rerun, `launch_app()` only polls `/live` through the port. It never checks `process.poll()`. If the new app fails to bind, the old app and old build answer, and the run "passes" against stale code. Stale `proxy-held` and `proxy-release` files in a reused state directory also make the hold and restart step return at once, so it does not test what it claims.
- (c) `inspect.mjs` compares S3 bytes with the DB row, not with the source fixture. The source-to-store chain relies on the response sha being equal to the row sha, and nothing asserts that.
- (d) The body-absence asserts look only at `/api/uploads*`. The PDF has no marker and is smaller than 4096 bytes, so the route check is its only guard.
**Evidence**: See the cited lines. Only assertion failures stop a pass from being written.
**Suggestion**:
- After each faulted run, assert that `proxy-control.json` is `{}`. Also assert at least two matching requests for that action in `requests.jsonl` from that run.
- Wrap the drive in `try/finally` to stop the owned processes.
- Require empty ports and `process.poll() is None` before you accept ready.
- Delete `proxy-held` and `proxy-release` before the hold step.
- Pass the expected source path to `inspect.mjs` and compare the raw bytes directly.
- Apply the size and marker checks to all requests, and assert that no request has `Transfer-Encoding`.
- Record the build revision and the dirty-tree hash in the report.

### 6. [Nit] The receipt is written in two places, with a synthetic session
**Location**: `postgres-storage.ts:272-277`, `direct-uploads.ts:209`
**Finding**: The legacy path builds a fake `upload_sessions` row: `audience: 'native'` even when the browser legacy route made the change, and a hardcoded `partBytes: 20 * 1024 * 1024` that copies `DIRECT_PART_BYTES`. `deleteArtifactBodies` depends on both writers keeping the receipt shape the same.
**Suggestion**: Make `commitHtmlVersion` (or a `recordHtmlVersion` beside it in `html-versions.ts`) persist the receipt, so both paths share one writer. At a minimum, import `DIRECT_PART_BYTES`.

### 7. [Nit] Replacement sessions without a receipt are kept forever
**Location**: `direct-uploads.ts:263` (`target_id is null`)
**Finding**: Aborted and failed replacement sessions have no receipt, but they are never pruned. Recovery and delete need only rows that have a receipt.
**Suggestion**: Prune with `receipt is null` instead of `target_id is null`. Keep that change together with finding 2, so a pruned ID cannot be reused by mistake.

### 8. [Nit] Weak checks in the proof script
**Location**: `live-cli.py:80,111-121`
**Finding**: The mutation check passes on any stderr that contains "chang", including "unchanged". The `hold` fault never forwards `complete` to the app, so the restart case proves resume before completion. It does not cover a completion that committed but whose response was lost across a restart. No live HTTP check covers PDF `inline` against `?download=1` attachment.
**Suggestion**: Match the exact error text. Add a forward-then-drop `complete` case across a restart. Add a HEAD or GET check of the PDF headers through the proxy.

### 9. [Nit] Doc placement and wrapping
**Location**: `docs/tools-platform/direct-transfers.md` (new lines)
**Finding**: The new text explains how the current code works ("locks the target, checks the expected old key…"). Your rules put that in service READMEs, not `docs/`. The new lines are also not wrapped, unlike the rest of the file.

## Open decisions

- **Findings 1 to 4.** Owner: the parent implementer. Fix them, or reject them with a stated reason, before the interrogate round with the other model family.
- **Finding 5.** Owner: the parent. Harden the live proof before its result counts as evidence for the PR or the release.
- **Findings 6 to 9.** Optional cleanup.

Next action: the parent applies the fixes it accepts, then runs the fresh live proof on the native VM fixtures.

## release-proof-20261016-r2-start

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-release-proof-20261016-r2-start

Status completed. Pending child runs false.

Committed `12d768b5dc3d697002431833665f68d9b0393aa1`. The isolated worktree is clean.

Added paired backup, read-only preflight, guarded restore, and raw-byte verification. Exact environment variables and commands are in [interface.md](/home/codex/.t3/worktrees/microservices/direct-upload-release-proof-vm-20261016/.agents/artifacts/direct-upload-release-proof-vm-20261016/interface.md).

The CLI supports:

- `preflight --tmpdir PATH`
- `backup --tmpdir PATH --directory NEW_PATH`
- `restore --directory BACKUP_PATH`
- `verify [--source] --directory BACKUP_PATH`

Syntax, whitespace, and real CLI help checks passed. Seven boundary tests remain unrun. Both attempts were blocked by the shared lock with exit 75.

Native backup/restore proof, newer-upload preservation, and independent review remain with the parent. CI, merge, deployment, and acceptance are unrun. No push or PR occurred.

Model the Domain shaped the manifest and ownership markers. Build the Lever made the proof rerunnable.

Dispatch was in-thread as assigned. The parent’s next action is to integrate this commit and run the documented checks.

## fleet-implementation-20261016-r1

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-fleet-implementation-20261016-r1

Status completed. Pending child runs false.

Committed locally on `fix/direct-html-uploads-vm-20261016`. The worktree is clean. `origin/main` remains an ancestor.

Changed six files:

- [Upload skill tests](/home/codex/.t3/worktrees/fleet/direct-html-uploads-vm-20261016/skills/file-upload/tests/test_upload.py) add expired-replacement CLI coverage and temporary test homes.
- [Root upload tests](/home/codex/.t3/worktrees/fleet/direct-html-uploads-vm-20261016/tests/test_file_upload.py) prevent installed credential loading.
- Four artifacts contain the [status and exact check commands](/home/codex/.t3/worktrees/fleet/direct-html-uploads-vm-20261016/.agents/artifacts/direct-upload-vm-20261016/status.md), [destination register](/home/codex/.t3/worktrees/fleet/direct-html-uploads-vm-20261016/.agents/artifacts/direct-upload-vm-20261016/destinations.json), [inventory script](/home/codex/.t3/worktrees/fleet/direct-html-uploads-vm-20261016/.agents/artifacts/direct-upload-vm-20261016/inventory.py), and [exact narrow release commands](/home/codex/.t3/worktrees/fleet/direct-html-uploads-vm-20261016/.agents/artifacts/direct-upload-vm-20261016/release.md).

Local checks passed: upload skill 29, root upload 8, scoped delivery 6, and target sync 25. One macOS test was skipped. Fleet validation, scoped dry run, deslop, and whitespace checks passed. One lock attempt was blocked with exit 75; its retry passed.

All 12 destinations remain pending. Five VM paths have the old installed script. Four Mac and three Home PC paths remain unobserved. These targets and unknown callers block legacy deletion.

CI has not run. Independent review is pending with the parent. No push, PR, merge, deployment, or installed rollout occurred. Max acceptance remains pending.

Model the Domain shaped the per-path register. Test Behavior, Not Implementation shaped the CLI test. Prove It Works required local hash observations. All work ran in-thread as the delegated Fleet unit.

The parent next owns live Tools CLI integration, Opus/Sol review, and PR work. Max owns later release approval.

## opus-fleet-review-20261016-r1

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-opus-fleet-review-20261016-r1

Status failed. Pending child runs false.

The provider could not start this turn. Retry the turn; if it keeps failing, check the provider setup and server logs.

## sol-fleet-review-20261016-r1

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-sol-fleet-review-20261016-r1

Status completed. Pending child runs false.

1. **critical. Changed-source recovery can publish stale HTML before rejecting it.**

   **Location:** [upload.py:253](/home/codex/.t3/worktrees/fleet/direct-html-uploads-vm-20261016/skills/file-upload/scripts/upload.py:253), completion at line 294, digest check at line 355.

   **Evidence:** Interrupt a replacement after Tools saves its durable manifest, leaving the session `completing`. Edit the source without changing its filename or size, then resume with the same UUID. Initialization accepts the unchanged metadata. The client skips all part digest checks because the state is not `uploading`, then calls `/complete`. Tools verifies the earlier stored body and commits the replacement pointer in [direct-uploads.ts:199](/home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016/services/tools/publisher/src/direct-uploads.ts:199). Only afterward does Fleet compare the returned digest with the edited source and report failure. Thus, a rejected resume can still change the public artifact. The test fixture never returns `completing`, so its source-change tests miss this path.

   **Small fix:** Send the local whole-file SHA-256 with completion and require Tools to compare it with the verified stored digest before committing the pointer. Add a recovery test that leaves a real session `completing`, changes the source, and verifies that the target stays unchanged.

## opus-fleet-review-20261016-r1-retry

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-opus-fleet-review-20261016-r1-retry

Status failed. Pending child runs false.

Provider turn failed.

## runtime-review-fix-20261016-r1

Task node:delegated-task:command%3Amcp%3A421fe6e7-eed6-413b-adaa-fc847f1899ab%3Adelegate-task%3Adirect-upload-vm-runtime-review-fix-20261016-r1

Status cancelled. Pending child runs false.

The resource suite is taking longer than the earlier runs. The unit tests and typecheck passed. I’ll inspect the active checks and fixture state to identify where the resource run is waiting.


## opus-paired-review-20261016-r2

Task node:delegated-task:command%3Amcp%3A2cf3706f-c13b-4f8b-82c5-d5a36c36cacf%3Adelegate-task%3Adirect-upload-vm-opus-paired-review-20261016-r2

Status completed. Pending child runs false.

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

## sol-fix-review-20261016-r3

Task node:delegated-task:command%3Amcp%3A2cf3706f-c13b-4f8b-82c5-d5a36c36cacf%3Adelegate-task%3Adirect-upload-vm-sol-fix-review-20261016-r3

Status completed. Pending child runs false.

**Runtime verdict: no findings.** The [worker patch](/home/codex/.t3/worktrees/microservices/t3-8b0c498d/services/tools/publisher/src/postgres-storage.ts:262) atomically transfers stale or revoked journal ownership to a retained failed replacement session. The writer returns 409; shared recovery continues. Cleanup retains the exact unpublished key, and the UUID stays reserved.

**Helper verdict: no findings.** The [backup helper](/home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016/services/tools/publisher/scripts/release-paired-backup.mjs:292) addresses the prior source identity, Railway host, TLS, and production stability findings. Source quiescence and bucket observation limits are explicit. Isolated restore still compares all saved tables.

Verification remains separate:

- Inspection completed. No files changed, tests run, services started, or production calls made.
- Existing focused evidence: 10 helper checks and 23 browser/Library checks passed.
- Full resource run: **failed**, 22 passed and 1 failed. The isolated 85 MiB retry passed with 22 filtered skips. This is not a full-suite pass.
- Live CLI, PDF viewer, and paired backup/restore proof remain unrun.
- CI, merge, deployment, and Max’s acceptance were not assessed.

No new code decision is required. **Parent owns the next action:** integrate the worker patch, verify the combined tree, and complete the outstanding proof. These verdicts do not establish release readiness.

## stale-journal-repair-20261016-r2

Task node:delegated-task:command%3Amcp%3A2cf3706f-c13b-4f8b-82c5-d5a36c36cacf%3Adelegate-task%3Adirect-upload-vm-stale-journal-repair-20261016-r2

Status completed. Pending child runs false.

Committed `0f1fd4a3ec42bd9dbd48619e51fb93bd71d9a080`. Worktree is clean.

- Storage now transfers stale journal ownership atomically to retained failed sessions. Writers still receive 409. Shared recovery continues, and existing cleanup owns the exact staged key.
- Added three PostgreSQL/S3 regression cases for conflicts, interruption, revocation, restart, retained bytes, and UUID reservation.
- Passed all 118 Publisher unit tests, typecheck, and diff check. Initial failures and the isolated passing run are recorded in the [handoff](/home/codex/.t3/worktrees/microservices/t3-8b0c498d/.agents/artifacts/direct-upload-stale-journal-r2/handoff.md).
- Resource regression remains unrun by instruction. CI and independent review are unrun. No merge or production change occurred. Max’s acceptance remains pending.

Model the Domain reused failed sessions. Fix Root Causes kept conflict handling in finalization. Test Behavior, Not Implementation shaped the regression. Laziness Protocol kept the existing lifecycle.

Parent owns the next action: apply the commit, run resource and app checks, then review. Implementation stayed in-thread; no nested delegates ran.

## opus-fix-review-20261016-r3

Task node:delegated-task:command%3Amcp%3A2cf3706f-c13b-4f8b-82c5-d5a36c36cacf%3Adelegate-task%3Adirect-upload-vm-opus-fix-review-20261016-r3

Status completed. Pending child runs false.

## Addendum, 06:42 UTC: the review stands, and the new resource run is not a pass

**Integration:** the worker commit 0f1fd4a was cherry-picked as 2496e2d. Its `postgres-storage.ts` and integration test are byte-identical to the worker diff I reviewed, so the runtime verdict does not change.

**R1 is still a blocker for the recovery claim.** The worker handoff describes its scope accurately: "Other errors still propagate." `upload_busy` is one of those errors, so two journal rows for the same page can still block each other forever.

### New evidence since the review

- **Resource suite on 2496e2d** (`resources-combined-final.log`, started 06:22): **failed, 20 of 26 passed.**
  - **Passed:** all three new stale-journal cases, the ambiguous-journal case, and the cleanup-ordering case.
  - **Failed:** six cases. Four of them were new failures compared with the earlier tmpfs run (22 of 23):
    - "stages replacements …": 500 instead of 200.
    - "rejects a stale replacement and never rebinds its UUID": timed out at 60 s.
    - "serves retained PDF MIME … inline": 500 instead of 201.
    - "recovers a lost S3 completion response …": 503 instead of 500.
  - **Also failed:** the 85 MiB case (timed out) and "checks bucket bytes …" (500 instead of 422).
  - **Log signals:** the log shows `CONNECT_TIMEOUT`, RustFS `SlowDownRead` and simple tests taking more than 20 s. This points to fixture or host load, but it is not proved.
  - **Why the repair is an unlikely cause:** none of the failing cases call the new conflict branch. Two tests that ran after the new test's storage restart also passed.
  - **Status:** I cannot attribute these failures, so they block any resource pass claim. The run should be repeated on a quiet host. Each new failure should be attributed before anyone calls it environmental.
- **Combined build:** passed. Its provenance record shows revision 2496e2d.
- **Combined verify:** blocked. It was still waiting for the heavy-check lock.

### Decision trail additions

- **Item 2 of my audit is now covered.** The new 06:18 row records the isolated 85 MiB rerun as "1 passed; 22 filtered skips; full suite still required". That is accurate.
- **Missing rows:**
  - the cherry-pick of 2496e2d;
  - the 20 of 26 combined resource result;
  - the combined build pass.
- **Items 1 and 3 to 8 of my audit are still open.**
- **No overclaim found** in the new row or in the worker handoff.

### Open decisions

| Decision | Owner |
|---|---|
| Fix R1 or accept it as a release risk | Parent and runtime owner |
| Attribute the 6 combined failures and rerun the 26-test suite on a quiet fixture | Parent |
| Record the combined resource and build results, and the cherry-pick, in `decisions.tsv` | Parent |
| H1: Railway deployment identity in the host guard | Parent |

Next action: the parent decides on R1, then reruns the full resource suite on a quiet host and records the result.
