# Candidate B: use the direct session as the version receipt

Select one durable operation record per upload. Keep the current artifact row as
the canonical pointer. Give each replacement its own staging ID and immutable
body key. Add a target ID, an expected revision, and a commit receipt to the
session. Make one Publisher state module own every canonical mutation.

This is an inspect-only candidate. No repository file was changed. No code,
resource test, deployment, distribution, or production action was run.

## Grounding: how Publisher works

### Overview and components

Tools is one TanStack Start application. Publisher owns artifact metadata,
sessions, bodies, and cleanup. PostgreSQL is authoritative. The private bucket
holds bodies. The platform owns browser authentication. Native upload routes
keep their separate bearer credential. Delivery URLs are public, unlisted read
capabilities. A protected HTML page here means its existing sandbox and delivery
headers, not a new browser login requirement.

`src/runtime.ts` builds the PostgreSQL-backed Publisher and starts its existing
startup and scheduled cleanup. TanStack routes pass requests through
`src/route-handlers.ts` to `publisher/src/fetch-app.ts`. That handler checks
native bearer credentials or the browser/guest route rules. The platform session
boundary still protects browser management routes.

`direct-upload-request.ts` validates JSON, classification, limits, project, and
route permission. `direct-uploads.ts` owns durable session control. It reserves
a UUID before storage allocation, signs bounded parts, saves a manifest before
completion, and commits verified objects and the completed session together.
Its advisory locks serialize requests for one session and bound verification.
`multipart-storage.ts` speaks S3 and verifies actual streamed bytes. Per-part
SHA-256 values are expectations. ETags and bucket metadata are not proof.

`postgres-storage.ts` reads the canonical object pointer and adapts the older
storage API. Its old mutation journal uses a lease and an owner token.
`storage.ts` implements legacy key operations, reads, and signed delivery.
`artifact-backfill.ts` imports only exact legacy `pages/` and `files/` names.
It excludes `transfers/`, so an unverified direct object cannot become public.

### Current flow and boundaries

1. A direct create reserves a request UUID and a random artifact ID. Clients PUT
   parts to the bucket. Tools receives JSON control requests, not those bodies.
2. Completion saves the manifest, completes S3, reads and hashes the stored
   bytes, then inserts metadata and completes the session in one transaction.
   Lost S3 responses and failed database commits can resume from the manifest.
3. HTML reads use the database key, stream through Tools, and add a favicon to
   the response. They retain sandbox CSP, no-referrer, no-sniff, and no-index.
   Stored bytes do not include that injected favicon.
4. Ordinary file GETs normally redirect to signed storage reads. HEAD,
   conditional requests, If-Range, and signing failures retain Tools handling.
   The current default attachment override forces PDFs to download. The
   fallback also sets attachment disposition.
5. Fleet already uses sessions for temporary files. Persistent HTML create and
   `--replace-id` still use multipart POST/PUT. Fleet checks source identity,
   retries within bounds, isolates credentials, and checks the returned digest.
   The browser replacement button also still sends legacy multipart.

### Gotchas that constrain this design

- The current direct key is `transfers/<session.artifact_id>`. Reusing a target
  ID as that staging ID would overwrite shared state and lose the old body.
- A legacy HTML PUT writes the current database key in place, including a
  direct-created key. Its journal recovery can upsert and set `revoked_at=null`.
  Session locking alone cannot protect against that writer.
- Project PATCH changes metadata outside the body write. A content-only token
  would miss this race and could restore an old project.
- The current delete path derives three keys from the canonical ID. It cannot
  find future replacement keys derived from independent staging IDs.
- Completed session rows currently expire from recovery after one day beyond
  session expiry. That is unsafe for retained replacement bodies and receipts.
  Completed retries also currently pass through the pending-session expiry check.
- Local chunk completion creates a new ID and removes its local directory.
  It has no durable direct receipt. An interrupted chunk completion must be
  accounted for before that writer can be removed.
- Old journal payloads can be JSONB objects or JSON strings. Keep both readers.
  Historical in-place overwrites cannot yield a lost prior body from metadata.

### Files read

Paths below are relative to the primary root unless marked otherwise. Large
handler and test files were read in focused sections, not in full.

- `README.md`; `docs/tools-platform/{README,runtime-boundaries,direct-transfers}.md`;
  `.agents/artifacts/direct-upload-fix-20261015/brief.md`.
- `services/tools/{README.md,package.json,database/postgres-schema.ts}`.
- `services/tools/publisher/{README.md,package.json}` and
  `src/{direct-uploads,direct-upload-request,multipart-storage,postgres-storage,
  storage,fetch-app,artifact-backfill,file-metadata,index,direct-upload-script}.ts`.
- `services/tools/publisher/ui/direct-upload.ts`; focused lifecycle and result
  sections in `ui/{publish-page,manage-page}.tsx`.
- `services/tools/publisher/test/{postgres-storage,direct-uploads.integration,
  fetch-app,storage,chunked-upload,stored-byte-validation}.test.ts`.
- `services/tools/src/{runtime,route-handlers}.ts` and
  `routes/api/{uploads,external-uploads}/$.ts` route adapters.
- Read-only Fleet caller inspection:
  `/Users/maximilianmauroner/Documents/GitHub/fleet/skills/file-upload/scripts/upload.py`
  and its `references/replace-html.md`.
- Architect skill, runner prompt, red flags, and rationale template under
  `/Users/maximilianmauroner/.agents/skills/architect/`; how skill and explainer
  prompt under the adjacent `how/` directory. No agents were spawned.

## Problem

Add native direct HTML create and replacement without changing IDs, URLs,
classification, limits, projects, retained bytes, expiry, or authentication.
Make races and recovery obey the same publication rule. Serve PDFs inline
where the browser supports them, with an explicit download action.

## Usage: caller first

Existing CLI commands and flags keep their meaning. Each operation prints and
can resume its request UUID. HTML now uses the same direct transport as files.

```sh
upload.py plan.html --project microservices
upload.py plan.html --replace-id <known-id> --request-id <same-operation-uuid>
upload.py report.pdf --expires-in 3d
```

Illustrative application calls, before deriving the types:

```ts
await client.upload(plan, { kind: "create", project: "microservices" });
await client.upload(revision, { kind: "replace", targetId: selected.id });
const pdf = await client.upload(report, { kind: "create", temporary: true });
// Existing Open uses pdf.url. Explicit Download uses pdf.downloadUrl.
```

The server selects and freezes the target revision at the first reservation.
The caller needs only the known target ID. Repeating the UUID resumes that
reservation. It never selects a newer expected revision. A conflict requires
an explicit new operation UUID after the caller inspects the current artifact.

## Shape and wire contract

These are design signatures, not implementation. HTTP objects and SQL rows
remain private to their adapters. Parse at boundaries, per boundary-discipline.

```ts
type RequestId = string & { readonly requestId: unique symbol };
type ArtifactId = string & { readonly artifactId: unique symbol };
type Revision = bigint & { readonly revision: unique symbol };
type BodyKey = string & { readonly bodyKey: unique symbol };
type ProjectChange = { kind: "keep" } | { kind: "set"; name: string };
type Intent =
  | { kind: "create"; content: HtmlContent | FileContent }
  | { kind: "replace"; targetId: ArtifactId; content: HtmlContent;
      project: ProjectChange };
// Content contains validated filename, MIME, size, and existing retention data.
type Reserved = {
  requestId: RequestId; stagingId: ArtifactId; bodyKey: BodyKey;
  operation:
    | { kind: "create" }
    | { kind: "replace"; targetId: ArtifactId; expected: Revision };
};
type VerifiedBody = { readonly verified: unique symbol;
  key: BodyKey; bytes: number; sha256: string };
type Snapshot = { id: ArtifactId; revision: Revision; key: BodyKey;
  kind: "html" | "file"; filename: string; contentType: string; bytes: number;
  sha256: string | null; project: string | null; createdAt: Date;
  updatedAt: Date; expiresAt: Date | null; uploadLinkId: string | null };
type Receipt = { format: 1; before: Snapshot | null; after: Snapshot };

interface ArtifactState {
  reserve(id: RequestId, owner: Owner, intent: Intent): Promise<Reserved>;
  commit(upload: Reserved, body: VerifiedBody): Promise<Receipt>;
  revoke(id: ArtifactId): Promise<void>;
  setProject(id: ArtifactId, project: string): Promise<boolean>;
  setExpiry(id: ArtifactId, expiry: Date | null): Promise<boolean>;
}
// Each body is `throw new Error("not implemented")` in a future scaffold.
// Session control/manifest methods stay internal to the direct upload module.
```

Use the existing native `/api/uploads/sessions` route and part/status/complete/
abort routes. Add this initialization field:

```json
{"requestId":"<uuid>","operation":{"kind":"replace","targetId":"<32-char-id>"},"kind":"html","filename":"plan.html","contentType":"text/html","totalBytes":123}
```

For create, `operation` is `{ "kind": "create" }`. Omission means create for
existing direct clients. Reject incompatible fields, non-HTML replacement, and
replacement through a guest link. Omitted replacement `project` means keep;
a present valid project means set. Bind UUID reuse to the normalized input,
operation, target, audience, and guest owner. Reject a changed binding with
`409 upload_conflict`. Do not compare newly computed retention timestamps.

Initialization and status keep all existing fields. Add
`operation:{kind:"replace",targetId,expectedVersion:"<decimal-revision>"}` or
`operation:{kind:"create"}`. Never expose bucket keys. Part requests and signed
PUTs do not change. Completion keeps the existing 201 response shape, adds
`version:"<decimal-revision>"`, and returns the canonical target ID for replace.
The response metadata comes from the saved receipt, not a later current row.
PDF file results also include `downloadUrl`, described below. Historical
completed rows without a receipt keep their old result decoder; omit `version`
when its original value is not known.

A completed status can still say `completed` after its pending expiry. Complete
returns its saved result while the artifact remains active, even if a later
replacement has won. It does no pointer write. After revoke or file expiry,
status/completion returns 404. Expired or aborted pending UUIDs cannot reopen.

## Exact minimal additive schema

Keep existing session columns, states, manifests, and artifact ID uniqueness.
Add four columns and these constraints/indexes through the typed schema:

```sql
ALTER TABLE artifacts.objects
  ADD COLUMN revision bigint NOT NULL DEFAULT 0
    CHECK (revision >= 0);
ALTER TABLE artifacts.upload_sessions
  ADD COLUMN target_id text,
  ADD COLUMN expected_revision bigint,
  ADD COLUMN receipt jsonb,
  ADD CONSTRAINT upload_sessions_target_check CHECK (
    (target_id IS NULL AND expected_revision IS NULL) OR
    (target_id IS NOT NULL AND expected_revision IS NOT NULL
      AND expected_revision >= 0 AND target_id <> artifact_id));
CREATE INDEX upload_sessions_target_idx
  ON artifacts.upload_sessions(target_id) WHERE target_id IS NOT NULL;
```

No body move, object rewrite, new version table, or new operation state is
needed. Existing rows read as revision zero and create sessions. `artifact_id`
continues to identify the unique stage. Create publishes that ID. Replace
publishes `target_id`. The stage key remains `transfers/<artifact_id>` for old
and new sessions. It is never reused for another operation or overwritten
after multipart completion. A new replacement always gets a fresh stage.

Validate `receipt` with one versioned decoder. JSON stores revisions as decimal
strings and dates as ISO strings. Its before/after snapshots retain every
canonical metadata field listed above and the exact keys. A nullable old
SHA-256 is retained as unknown, never invented. New after snapshots require
the digest from actual stored-byte verification.

Stop pruning operation identities. Keep terminal session rows and replacement
receipts; compact parts/manifests only when no longer needed for recovery.
Existing completed rows retain their description, digest, and canonical ID for
the legacy result decoder. Do not fabricate historical snapshots or revisions.
This small ledger is the deliberate cost of UUID recovery,
retained versions, and exact key ownership for one uploader.

## Commit, lifecycle, and recovery

1. Reserve replacement under the target row lock. Require active HTML, no
   unresolved legacy intent, and an eligible owner. Save its current revision
   as `expected_revision`. Reserve a different random stage before S3 work.
2. Keep the existing session advisory lock, manifest-before-completion rule,
   bounded verification, and independent database pools. Stream the completed
   stage to check total size and every declared part SHA-256. Compute the whole
   SHA-256. Only this verifier can construct `VerifiedBody`.
3. In one short transaction, lock the target, check the database clock for
   session/link validity, and require `kind='html'`, active state, and the saved
   revision. Save the before snapshot. Update the pointer and content metadata,
   increment revision, save the after receipt, and set the session completed.
   Preserve `created_at`, ID, HTML persistence, and omitted project. A failed
   compare makes the session terminal failed and returns 409. Retain its cleanup
   identity. Do not delete another writer's body.
   Create uses an insert-only canonical commit at revision zero. A duplicate ID
   or existing tombstone is a conflict, never an upsert.
4. Two replacements can upload in parallel. Only one can commit the captured
   revision. Project PATCH also increments revision, so it wins or causes the
   upload to conflict. File expiry updates use the same row owner and revision.
   Keep expiry canonical in PostgreSQL; do not copy an immutable body to change
   bucket expiry metadata. Existing readers use database expiry.
5. On crash before commit, no canonical pointer changed. A retry verifies the
   same unique object again and retries the same comparison. On crash after
   commit, receipt and pointer already agree. A retry returns the receipt.
   Never replay a successful old receipt as a write.
6. Cancel and completion serialize on the session lock. Cancel first makes
   pending work terminal and aborts only its own storage work. Commit first
   leaves the published artifact intact. Expiry cleanup follows the same rule.
   Successful replacement keeps the prior body and before metadata.
7. Revoke first commits a tombstone and increments revision under the target
   row lock. Retain the object row, so backfill cannot adopt its legacy body.
   Record a durable delete intent in the existing operations table. Then abort
   pending sessions and delete exact owned keys. Do not hold a target row lock
   while waiting for a session lock. A verifier can finish reading but cannot
   commit across the tombstone.
8. The delete intent includes the current key, every target session stage key,
   receipt before/after keys, and the three known legacy keys. Preserve this
   manifest until every abort/delete succeeds. Retry missing keys as success;
   retain failures for the next sweep. Once a session is terminal, its cleanup
   cannot delete any key other than its own uncommitted stage. Revoke may delete
   retained versions only for this explicit artifact lifecycle action.

Cleanup must recheck terminal state under the session lock. It must never
remove a committed body because a receipt is old. Resolve ambiguous multipart
completion from its known upload ID/manifest, then check and delete the unique
resulting key when abort wins. An abort response alone does not prove that a
remote completion lost the race. Keep terminal key identities and revisit
aborted/revoked keys in bounded sweeps, including records with `cleaned_at`, so
a late body cannot escape cleanup. Test this with delayed real S3 requests.

## Module map and legacy writers

- Add `publisher/src/artifact-state.ts` as the sole SQL owner of canonical
  mutations, revisions, receipts, session terminal commit, tombstones, and
  journal reconciliation. Keep it private to the Publisher package.
- Keep `direct-uploads.ts` as the direct transfer owner. It manages session
  control and S3 progression; it asks state to reserve and commit. Replace its
  direct canonical INSERT. Do not add a chain of generic repositories.
- Keep `postgres-storage.ts` as the existing read/storage adapter. Its lifecycle
  methods call state. Delete its unconditional publication upsert. Keep old
  JSON-string journal decoding in state until all old records are accounted for.
- Keep bucket byte validation in `multipart-storage.ts`, and use exact-key
  abort/delete primitives there for both cleanup and revoke.
- Parse operation JSON in `direct-upload-request.ts`. Implement PDF delivery
  policy once in the file handler and pass a typed delivery choice to storage.
- Fleet switches HTML create/replace into its current direct function. Browser
  Replace keeps its button but uses `ui/direct-upload.ts` with a target ID.

While old HTTP writers remain required, their local staging adapter must use
the same reserve, unique key, stored-byte check, conditional commit, and receipt
owner. It may upload local bytes, but it may not overwrite a canonical key or
call the old upsert. This is one commit policy behind two transports. Remove
those transports only after the caller register and local chunk drain prove
that they can go. A partial retirement is not part of this candidate.

Old-format journal entries have no reliable expected revision. Drain them
during Max's explicit uploader pause, before new writers start. In a guarded
drain, compare raw stored size/digest and preserve their payloads and current
metadata. Adopt only an unambiguous still-current operation. After activation,
an old-format record must not upsert across any new revision or tombstone.
Quarantine ambiguous entries for the release owner. Missing old bytes are a
recovery blocker, not grounds to synthesize a before version. Keep historical
readers. Prove this with the JSON-string fixture and newer-write fixtures.

## PDF delivery

Keep `/files/:id/:filename` as the canonical URL. For stored normalized MIME
`application/pdf`, default to `inline` with the safe stored filename. Add
`?download=1` as the explicit attachment URL and return it as `downloadUrl` for
PDF results. Add Download beside the existing Open action in result/library
views. Use the query on the server; an HTML `download` attribute cannot control
a cross-origin signed redirect reliably.

The signed GET must override both bucket fields: `application/pdf` and inline
disposition for PDF viewing. Explicit download uses attachment disposition and
the current binary download type. Use the same decision for HEAD, ranges,
conditional responses, and streaming fallback. Retain expiry-bounded signature
duration, no-store, no-referrer, CORS, byte validators, and range rules. Do not
rewrite old objects. PDF viewer support remains a browser feature. Non-PDF
delivery and protected HTML delivery retain their rules.

## Alternatives and selection

**A. Separate version ledger.** Add `artifact_versions` with one immutable key
and metadata snapshot per version; point objects and sessions to version IDs.
This makes history reads simple and keeps session pruning independent. It adds
a second durable ledger, adoption rules for old rows, and more joins. Its public
interface is equally small, but it hides no additional policy needed here.

**B. Session receipts, selected.** Extend the durable operation that already
exists. The stage is independent, and one state owner handles publication and
lifecycle. Callers learn one operation and never coordinate storage or compare
tokens. The receipt is also the key registry. We accept retained session rows
in exchange for no parallel version table or bulk metadata migration.

**C. S3 versions as authority.** Enable bucket versioning and store provider
version IDs. This hides body retention in storage but exposes provider recovery
and deletion rules across readers, cleanup, and backups. It needs a bucket
configuration change and still needs a PostgreSQL conditional pointer commit.
Reject it for this bounded change.

Candidate B is this runner's selection, not a claim that cross-runner synthesis
has occurred. Red-flag screen: one mutation owner; one commit rule; no exported
wire or SQL types; no mirrored key list; no mutable replacement key; no caller
sequence beyond the established direct protocol. Legacy adapters must retire
with their confirmed callers, so they cannot become a second commit design.

## Testing and release seams

Extend existing tests with actual outcomes, not source-string assertions:

- Real PostgreSQL/S3: create then replace; two staged writers; project race;
  revoke during verification; delayed completion versus abort; lost S3 response;
  failed database commit; process restart; repeated completion after a newer
  replacement; expired/aborted UUID replay; receipts past the old pruning age;
  exact key deletion with one failed delete and a successful retry.
- Journal fixtures: both old JSON encodings; old write after a newer commit or
  tombstone; ambiguous missing metadata; retained legacy/current/direct bodies;
  backfill after revoke. Prove no resurrection and no deletion of a newer key.
- Run actual Fleet CLI against isolated Tools for HTML create/replace and file
  resume. Check request UUID recovery, source mutation, project defaults, digest,
  retry bounds, expiry, and credentials. Count file bodies at storage and JSON
  controls at Tools. Compare raw stored bytes separately from HTML responses.
- Browser: PDF Open shows inline delivery where supported; Download forces
  attachment. Test signed redirects and fallback, HEAD, range, If-Range,
  conditional requests, expiry, revoke, Unicode filename, and unchanged HTML
  headers/favicon. Use owned loopback PostgreSQL with its disposable sentinel
  and the `tools-transfer-test` bucket. A skipped suite is not a pass.
- Run focused Publisher/Tools tests and typechecks first, then Tools build,
  `pnpm run verify`, Fleet validation, and both Fleet upload suites.

Release remains a separate approved action. Prepare paired database/bucket
backups, manifests and an isolated restore proof; local legacy-chunk drain and
journal recovery proof; a caller register; all declared device and harness
destinations; and exact Railway and narrow Fleet distribution commands. Pause
Max's uploads for the coordinated cutover. An offline destination or unknown
writer blocks removal of its old path. Do not use a broad Fleet apply command.

Recovery keeps the additive schema. Restore the pair into isolation first.
Repair a pointer only if the affected current revision is still the failed
operation's revision, then create a new higher revision and recovery receipt.
Never replay an old snapshot over a later write. Do not roll back to a server
that can overwrite immutable keys or clear tombstones. There is no atomic
rollback across Railway and installed clients.

## Status and next action

Inspection and design red-flag screen: passed. Local execution checks: not run,
as required for this inspect-only task. CI, independent review, and merge: not
run. Production and installed clients: unchanged. Max's acceptance: pending.

Open decisions: the parent implementation owner selects the architecture after
candidate comparison and resolves caller/drain evidence. Max owns approval of
the final release action. Next action: test the conditional commit and receipt
against racing replacement, project PATCH, and revoke before client integration.
