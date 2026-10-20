# Direct artifact transfers

Publisher authorizes uploads in Tools. Clients send file parts to the private
Railway bucket with five-minute signed URLs. PostgreSQL owns upload sessions,
part digests, completion manifests, and published metadata. Create bodies live under
`transfers/<artifact-id>`. Each HTML replacement has an immutable
`transfers/<target-id>/<staging-id>` body. Canonical `/artifacts/:id` and
`/files/:id/:filename` URLs stay unchanged.

## Upload protocol

Use `/api/uploads/sessions` with the native upload bearer credential,
`/api/external-uploads/sessions` with the browser session, or
`/api/drop/:token/uploads/sessions` with an active guest capability. Browser and
guest mutations require the same-origin check. Status GETs allow the normal
absent Origin header and reject an explicit conflicting Origin. Browser reads
still require the browser session; guest sessions are bound to the upload-link
ID. Native credentials never travel to storage.

1. POST JSON with a UUID `requestId`, `filename`, `contentType`, and
   `totalBytes`. `kind` defaults to `file`; authorized browser/native clients
   can create persistent `html` and pass `project`. An HTML replacement also supplies `replaceId`. Initialization echoes the target
   before the client sends any part. The response contains
   `sessionId`, `partBytes`, `totalParts`, `uploaded`, `state`, and `expiresAt`.
   Repeat initialization with the same request ID and file description to
   recover a lost response or resume. File sessions expire after two hours.
2. For each one-based part, calculate its SHA-256 over at most 20 MiB. POST
   `{ "number": 1, "sha256": "<64 lowercase hex characters>" }` to
   `/:sessionId/parts`. PUT that Blob/buffer to the returned signed URL. Its
   signature includes the expected Content-Length. Do not send cookies, the
   native token, or storage credentials to this URL.
3. GET `/:sessionId` or repeat initialization to inspect accepted parts after
   interruption. Before skipping a stored part, request its URL with the local
   digest again; the saved digest must match. A successful PUT whose response
   was lost can be safely sent again with the same part number and bytes.
4. POST `{ "sha256": "<selected source whole-file digest>" }` to
   `/:sessionId/complete`. Tools reads storage's part sizes and ETags,
   persists the manifest, completes multipart storage, and streams the stored
   bytes through bounded SHA-256 validation. It checks every part digest and
   total length, then atomically inserts canonical metadata and marks the
   session completed. The selected-source digest must match before publication.
   A mismatch returns `409 source_changed` and preserves recovery state.
   Empty completion bodies remain accepted for older clients. An HTML
   replacement changes the canonical pointer only if its expected version is
   still current. Repeated completion returns the saved result.
   Missing parts return 409; incorrect size or content returns 422 and cannot
   be published. Retry transient failure with the same session.
5. DELETE `/:sessionId` to abandon pending work. Aborting also invalidates its
   multipart URLs. Aborting a completed session does not revoke a published
   artifact; use the existing artifact lifecycle API for that.

The native client is available from this checkout:

```sh
PUBLIC_BASE_URL=https://tools.mauroner.net UPLOAD_TOKEN=<native-token> \
  pnpm --dir services/tools/publisher upload:direct /path/to/file [request-id]
```

The client prints its request ID before transferring bytes. Retain it to resume
after an agent process interruption. The browser keeps this ID in sessionStorage;
reselect the same file in the same tab to resume. Signed URLs are kept in memory.
All current size limits still apply. Empty files use one empty part.
Cancel aborts pending browser control and part requests and abandons the pending
session. A completion that committed before cancellation remains published;
session cancellation does not revoke an already published artifact.

## Integrity and recovery

[Railway's supported API](https://docs.railway.com/storage-buckets#s3-compatibility)
includes multipart uploads, but its public documentation does not specify a
complete contract for multipart SHA-256 checksum fields. A multipart ETag is
not a whole-file SHA-256, and user metadata does not prove stored content.

The implementation uses standard Create/ListParts/UploadPart/Complete/Abort
operations and verifies actual stored bytes. Provider-validated part checksums
could remove the verification read if that complete contract is later proven.
The current read costs bucket egress, which Railway makes free. It uses bounded
stream buffers and no local file assembly or application-to-bucket body upload.
Hashing still uses CPU, and a retry after interrupted verification repeats the
read. Production transfer speed and savings remain unmeasured.

A durable reservation precedes S3 creation. Cleanup finds unknown multipart
IDs by that reservation's unique key, including a lost creation response.
A durable manifest precedes S3 completion. After a lost completion response or
failed database commit, a retry checks the completed object, verifies its
bytes, and performs the canonical commit once. PostgreSQL advisory locks
serialize session writers and bound concurrent completion across web processes;
locks release on process exit. Separate small connection pools keep durable
writes available during verification. Verification has a 15-minute deadline.

Limits include 250 parts, 16 pending control requests per web process, at least
16 active sessions globally (four per configured concurrent upload above that),
and three pending sessions per guest link. Signatures end no later than session
expiry. Guest link expiry and revocation are checked again using the current
database clock before the commit. A revoked link cannot publish pending work.
Successful files stay available under their existing artifact retention rules.

Publisher's existing startup/hourly cleanup removes abandoned, expired,
invalid, and revoked-link multipart work in bounded batches. Completed session
receipts are retained for at least one day after session expiry, then pruned in
batches. Replacement receipts and UUID bindings remain for recovery. Cleanup does not
delete published bodies when a create receipt expires.
No separate keep-awake timer is added.

Restore PostgreSQL metadata and sessions together with the bucket. The legacy
pages/files backfill deliberately excludes `transfers/`; it must never adopt an
unverified object. This makes a successful byte verification and canonical
commit the only publication boundary. Artifact deletion removes the direct
body as well as legacy keys. HTML replacement changes the canonical object pointer and
preserves its stable capability URL. Its full before and after receipt retains the old
body key, metadata, and digest. Stale operations cannot overwrite a later version or
clear a revocation tombstone.

## Downloads and remaining body transfers

All non-conditional file GET requests now redirect after capability and expiry
checks, including small attachments. Storage handles normal ranges. MP4 keeps
its existing four-hour maximum signature for playback and later seeks; other
attachments retain the same maximum. PDFs use inline disposition and application/pdf,
including historical binary-classified .pdf filenames. ?download=1 forces attachment.
Other files keep attachment disposition and a binary content type. Signed reads use
private no-store caching. Expiry shortens signatures.
Revocation deletes the object and denies later canonical requests. Shortening
an expiry does not invalidate a signature already issued for the earlier expiry.

HEAD retains the canonical metadata response and sends no body. If-Range and
conditional requests retain Tools handling because the canonical SHA-256 and
modification date differ from storage validators. Signing failure and the final
second before expiry retain the streaming fallback. HTML remains streamed with
its sandbox CSP, favicon injection, and private cache policy. No shared caching
of private responses is added.

Other binary paths were traced: guest-link ZIP downloads still stream a newly
generated archive; no repeated ZIP traffic appears in the retained audit sample,
so no archive cache was added. Feedback CSV is generated from PostgreSQL.
Document Share source downloads are browser Blobs. Fixed icons/assets are
already local static responses. None requires a new storage transfer path.

## Active compatibility

The native multipart `/api/uploads` and chunk `/api/uploads/chunks` handlers in
`publisher/src/fetch-app.ts` remain for external clients. Observed external callers must switch to sessions or `upload:direct` separately.
The retained audit sample is in the task artifacts.
Their legacy uploads still incur application-to-bucket egress and have their
existing local-staging restart limit. Current Fleet HTML creation and replacement use
sessions. The legacy multipart replacement route remains until all installed callers are
accounted for.

Browser multipart/chunk endpoints and their local staging also remain for
already loaded browser bundles during rollout. The current React console and
guest page use sessions for every new file. The old React chunk transport and
its protocol-only tests were removed. Retained server chunk tests cover the
active legacy contract.

Remove browser upload compatibility after the new build is deployed, old
bundles have aged out, and route observations confirm no calls. Remove native
creation/chunk compatibility only after external caller owners confirm migration
and route observations confirm no calls. Keep the legacy replacement writer until every
declared device and harness has verified the direct client and offline or unknown
callers are accounted for. No removal is authorized here.

The artifact recovery reader in `publisher/src/postgres-storage.ts` also accepts
JSON strings written by the old double-encoding path. New recovery records use
native JSONB objects. Keep that decoder for retained historical recovery data.
It preserves interrupted legacy replacements,
including replacements of HTML created through a direct session.

## Release constraints

The schema addition keeps existing rows and historical readers. Replacement
sessions add nullable `target_id`, `expected_object_key`, and `receipt` fields,
a target constraint, and a partial target index. Keep these declarations and
stored values because they bind retries and retain recovery evidence.

An exact pre-PR image is unsafe once replacement data exists. Its schema
omits these additions. Its normal noninteractive predeploy can exit 2 when
Drizzle proposes their removal. Do not force the push, drop the fields, or
bypass the schema guard.

A compatibility build must keep the current Publisher storage and transfer
subsystem together. This includes its schema declaration, immutable-key
writers, receipt-aware delete and cleanup, and recovery. Older writers can
overwrite retained version bodies. Older delete and cleanup code can lose
bodies or receipts. If this subsystem is faulty, fix forward.

Before an approved deployment, keep uploads quiet and run these read-only
checks. Both counts must be zero:

```sql
select count(*) from artifacts.operations;
select count(*) from artifacts.upload_sessions
where target_id is not null and state in ('creating', 'uploading', 'completing');
```

If either count is nonzero, wait for recovery or session expiry and cleanup.
Check again before the deployment. Prove the compatibility build against an
isolated database with populated replacement fields and retained receipts.
Its normal guarded predeploy, retained completion replay, reads, and cleanup
must pass before Max approves the deployment.

A database restore and a backend deployment do not roll back external clients.
Recover metadata together with its referenced bodies. Keep newer commits and
all retained versions when recovering from an older backup.

Max can abstain from uploads for a short server-first release. Keep the legacy
writers until every device and harness has verified the direct uploader and
unknown callers are accounted for. An offline target does not prove cutover.
Production bucket behavior and CORS require separate approved verification.
Local S3 evidence does not establish the production provider's behavior.

The concrete release procedure and per-target state belong in
`.agents/artifacts/`, with the paired backup and isolated recovery evidence.

## Isolated verification

Run the normal Publisher and Tools checks first. `pnpm run verify` runs the
real-resource suite with an owned PostgreSQL fixture and the S3 storage of an
owned local stack. To run it alone, use separately owned loopback PostgreSQL and
S3 and local fixture credentials. The database must hold the disposable
database sentinel table `tools_runtime_test_sentinel` and the current schema.
The suite creates the `tools-transfer-test` bucket if it is missing.

The suite does not set bucket CORS, because the pinned MinIO build does not
support it. The S3 server must allow PUT preflight from the test origin, deny it
from unrelated origins, and allow reads from the `null` origin. For MinIO, start
the server with `MINIO_API_CORS_ALLOW_ORIGIN=http://127.0.0.1:43171,null`. This
global setting applies to all methods of both origins. The test origin is
`http://127.0.0.1:43171` and the credentials are `transfer-local` and
`transfer-local-secret`. `PUBLISHER_TRANSFER_TEST_ORIGIN`,
`PUBLISHER_TRANSFER_TEST_S3_ACCESS_KEY_ID`, and
`PUBLISHER_TRANSFER_TEST_S3_SECRET_ACCESS_KEY` override them.

```sh
TEST_DATABASE_URL=postgres://transfer_test@127.0.0.1:45432/tools_runtime_test \
TOOLS_TEST_DATABASE_CONFIRM=tools-platform-test \
  pnpm --dir services/tools run db:push-postgres:test
PUBLISHER_TRANSFER_TEST_DATABASE_URL=postgres://transfer_test@127.0.0.1:45432/tools_runtime_test \
PUBLISHER_TRANSFER_TEST_S3_ENDPOINT=http://127.0.0.1:49000 \
  pnpm --dir services/tools/publisher exec vitest run \
    test/direct-uploads.integration.test.ts --maxWorkers=1 --fileParallelism=false
```

This suite checks large direct transfers, interruption/resume, repeat completion,
lost storage responses, database commit failure, owners, expiry, revocation,
wrong size/content, cleanup, concurrency, protected HTML replacement, ranges,
HEAD, conditional reads, CORS, and private bucket access. Browser transport tests
check resume, safe completion retry, cancellation, and credential isolation.
Use the product verification skill for actual browser and playback evidence.
Keep reports and captures under ignored `.agents/artifacts/`.
