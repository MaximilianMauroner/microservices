# Release the reviewed upload pair

This procedure is prepared for Max's later approval. It has not run.
Max can approve this one release action after the draft PR checks and open
acceptance prerequisites are complete. The continuation owner executes the
steps and records each result. Max refrains from uploads during the backup,
recovery check, and backend replacement.

## Fix the release scope

Use the exact reviewed Microservices and Fleet PR heads. Do not substitute a
shared dirty checkout. Prepare clean isolated release checkouts on the MacBook
Air controller under `~/.agents/releases/direct-uploads-20261016/`.
Record both heads and the source upload script hash before the action.
Keep both PRs draft until Max approves merge and release.

Read-only Railway discovery confirmed these resources.

| Resource | Name | ID |
| --- | --- | --- |
| Project | tools-platform | 87d88446-cd98-4a45-8097-99d46e7826fe |
| Environment | production | b0bb7096-88c8-4798-b1b8-92e3c9bddcfa |
| Web service | tools-web | 70d77857-6c88-4dff-82d1-5e0d7722c293 |
| Artifact bucket | html-pages | 1961a5bd-5f5c-4e48-a4ee-350c10a735b9 |

The service source is `MaximilianMauroner/microservices`.
Its start command is `pnpm --dir services/tools run start`.
No local Railway binding, deployment setting, secret, or production data changed.
Read-only trigger discovery on October 16 confirmed one GitHub trigger for
`main` in this exact project, environment, and service. Its `checkSuites` setting
is false. Merge of the approved Microservices PR is the one backend trigger.
Do not also run `railway up` or redeploy. Recheck the trigger before the approved
action and stop if it changed. The redacted evidence is `railway-trigger.json`.

## Execute the approved action

1. Confirm Max has stopped uploads. Inventory every live web instance and its
   actual `os.tmpdir()` through bounded Railway SSH. Enumerate each instance
   explicitly. Do not treat the CLI's default first instance as every replica.
   Inspect all `artifact-*` entries with the release helper's read-only inventory
   rules. Save the inventory privately. A pending local chunk, unknown file,
   journal operation, direct session, or S3 multipart upload blocks deployment.
   Retained ambiguous journal evidence remains a blocker. Report its separate
   count and get a concrete recovery decision if such a row actually exists.
   Do not delete the row or its body to pass preflight.
   Complete a known chunk through its existing client and same session before
   retrying. Preserve its files and manifests as recovery evidence first.
2. Capture the paired production database and bucket backup inside the source
   service with the reviewed helper's `--production-source` mode. Require
   matching pg_dump and the explicit verified-TLS CA file before that command. Read only the approved Tools database and
   html-pages bucket. Obtain configuration through the approved Railway service
   environment without printing or saving secrets in Git. Compare the actual
   database, bucket name, endpoint, and addressing style with this resource
   scope. Capture all Tools and artifacts rows and every bucket body and writable
   metadata field. Require `COMPLETE`, matching manifests, and raw hashes.
   Keep the exact HTTP-date guard. The actual provider's listing and GET dates
   must satisfy it. Stop on a mismatch. Do not add unverified rounding tolerance.
3. Transfer the private backup to the controller without exposing credentials.
   Restore that backup into fresh owned loopback PostgreSQL and S3 targets.
   Require the disposable sentinel, owner token, empty target checks, complete
   database comparison, and raw body and metadata comparison. Keep the paired
   backup and recovery copy private. Repeat source verification and the live
   legacy inventory immediately before the backend trigger. Keep all source
   data unchanged.
4. Use the approved merge procedure for Microservices PR58 with its reviewed
   head pinned. Merge that PR once and observe the existing GitHub deployment.
   Do not change Railway source settings or credentials.
   Wait for that exact deployment to become healthy. Check public HTML, PDF
   inline and download, auth boundaries, and direct initialization with an exact
   replacement target echo before distributing clients.
5. Merge the approved Fleet PR and run only its narrow file-upload delivery
   commands from the clean Fleet release checkout on the MacBook Air. Process
   all three devices separately. Record all twelve declared paths, script
   hashes, link targets, and fresh harness discovery. Use a Max-approved upload
   fixture for live acceptance. A failed or offline device stays pending.
6. Resume Max's uploads after backend acceptance. Keep the fixed legacy writers.
   Report backend, each installed destination, caller inventory, and Max's
   acceptance separately. Unknown callers prevent declaring cutover complete.

The backend trigger, after Max approves the merge procedure and all preflight
steps pass, is the following. Resolve the reviewed head from the isolated
release checkout and compare it with the approved PR head first.

```sh
RELEASE_MS_HEAD=$(git rev-parse HEAD)
gh pr merge 58 --squash --match-head-commit "$RELEASE_MS_HEAD"
```

The exact installed delivery commands are the following.

```sh
scripts/update-fleet --apply --skill file-upload --device macbook-air
scripts/verify-fleet --skill file-upload --device macbook-air
scripts/update-fleet --apply --skill file-upload --device coding-vm
scripts/verify-fleet --skill file-upload --device coding-vm
scripts/update-fleet --apply --skill file-upload --device home-pc
scripts/verify-fleet --skill file-upload --device home-pc
```

Never omit `--skill file-upload`. A broad device apply changes all managed state.
No mandatory observation week or global pause service is part of this action.
A deployment cannot update or roll back external machines atomically.

## Recover without losing newer uploads

Before new uploads resume, an application rollback can use the previous backend
version after compatibility checks. Keep the additive schema, immutable bodies,
and new receipts. Do not restore the older database over the live source.
After uploads resume, a rollback must preserve every newer canonical commit,
session, receipt, and body. Restore the backup into isolated targets and compare
there. Reconcile an identified fault with a reviewed forward repair.

A partial Fleet delivery uses each device's own existing backup and its own
observed status. Do not copy device backups between machines. A body in staging
is recovery evidence. Do not rebind an uncertain request to a new UUID.

## Current boundary

Local source changes and proofs do not approve this procedure for production.
Actual production credentials, instance inventories, local chunk drain, source
mapping, production paired backup, and its isolated recovery proof remain steps
of the later approved action. No production access is inferred from local tests.
Browser Library replacement and Download acceptance require an authorized local
OAuth client. Keep those checks blocked until that prerequisite exists.
All twelve installed destinations remain pending.
