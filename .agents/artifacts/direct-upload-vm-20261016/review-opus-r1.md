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
