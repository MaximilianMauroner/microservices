**I found no remaining findings.** The R1 dismissal is valid, and the guard change is correct for what it claims to do.

## R1 dismissal: valid

- **The precondition cannot occur.** `uniqueIndex("artifact_operations_artifact_idx").on(table.artifactId)` is at `services/tools/database/postgres-schema.ts:409`. It is the same in HEAD and `origin/main`, and it has been there since `0e54284`. Production schemas get it through Drizzle push (`e23799e`). So `artifacts.operations` can never hold two journal rows for one `artifact_id`.
- **The repro supports this.** `parallel-journals-before.log` shows PostgreSQL rejecting the second fixture insert with `23505` (`test:313`). That happens before any recovery code runs, so the test never reaches the scenario R1 describes.
- **The `upload_busy` path cannot block itself.** `commitHtmlVersion` (`html-versions.ts:25-28`) leaves out the caller's own `journalId`. Recovery always passes `operation.operationId` (`postgres-storage.ts:271-275`). With at most one journal per artifact, recovery finds no other pending row and cannot get `upload_busy` from this check.
  - Only a direct completion, which passes no `journalId`, can hit `upload_busy` while a journal exists. That is temporary: it clears when the journal is reconciled, and the client retries (`direct-upload-script.ts:12`).
- **Case variants do not get around the index.** Journal `artifact_id` values come from stored canonical IDs (`canonicalId(session)`, or the existing object row). Request paths do not supply them. The UUID case-variant handling applies to `session_id`, which is a `uuid` column.
- **Removing the invalid regression test was correct.** Keeping the patch and log as evidence is enough. `decisions.tsv` row 28 records this accurately.

## Guard change (`release-paired-backup.mjs` and its test): correct

- `onSourceHost` now also requires a non-empty `RAILWAY_DEPLOYMENT_ID` and a non-empty `RAILWAY_REPLICA_ID`. The project, environment and service must still match. Both callers, `preflight:317` and `backup:332`, enforce it through `requireSourceHost`.
- `sourceInstance` is added only for production sources, and only to the preflight and backup reports. Nothing reads it back: `restore` and `verify` use only `manifest.source`. So it cannot break `requireSourceIdentity` or restore checks.
- A production restore is still refused, because `configuration(production, true, true)` throws.
- The new assertions cover both sides of the guard: the Railway scope without deployment or replica gives false, and the scope with both gives true. The existing test at `test.mjs:158` still covers the refusal message.

## Minor points, not blockers

- The guard only checks that the variables are present. It does not match them against an expected deployment. That is enough to stop an accidental off-host run, and the recorded values give an audit trail. An operator who sets the variables by hand can still get past it.
- The error message at `:308-309` does not name the two new variables. An operator who forgets to set them will see "must run inside the exact Railway project, environment, and service" and may not see the cause.

## Status

| Item | Status |
|---|---|
| This review | No findings. Inspection only. I changed no files and ran no tests or processes. |
| Full 26-test resource rerun and 10 boundary checks | Running, not seen by me. The earlier 20 passed and 6 failed result is not a pass. |
| Real app CLI, PDF and paired proof | Pending. |
| CI, merge, Max's acceptance | Not started. |

**Open decisions:** none from this review. The parent owns attributing any failures in the running suite.

**Next action:** the parent waits for the 26-test rerun and records the result in `decisions.tsv`.
