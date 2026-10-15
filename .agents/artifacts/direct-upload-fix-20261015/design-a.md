# Design A: direct HTML replacement and PDF delivery

Status: candidate design. No repository file changed. Source: worktree
`fix-direct-uploads-tools-and-fleet-20261015` at main `711f819`, Fleet
`origin/main` `0c4bf5d` (read through `git show`, no checkout).

## Result

Select **A: replacement is a variant of the existing direct session**.

- A replacement session keeps `upload_sessions.artifact_id` as its unique
  staging identity (a fresh version ID). Three additive nullable columns hold
  `target_id`, `expected_object_key`, and the `superseded` snapshot.
- Its body key is immutable: `transfers/<targetId>/<versionId>`.
- The expected version token is `artifacts.objects.object_key`. This is safe
  because after this change no writer reuses or overwrites a committed key.
- One function, `commitHtmlVersion`, is the only code that moves an HTML
  pointer. The direct path and the retained legacy multipart path both call it.
- Revoke and delete remove the fixed legacy keys plus every object and
  multipart upload under `transfers/<id>/`.
- PDF: one pure `fileDelivery()` decision. Signed inline for PDF, explicit
  `?download=1` for attachment. One `artifactUrls()` builder returns `url` and
  `downloadUrl`.

Wire change: one optional field `targetId` on session creation, one new
terminal error `replace_conflict`, one response field `downloadUrl`, one query
`?download=1`. Schema change: three columns, one check, one partial index.

---

## 1. Grounding (how-style)

### Overview

Publisher stores HTML pages and files in a private bucket. PostgreSQL row
`artifacts.objects` is the canonical pointer: `id -> object_key, sha256,
bytes, filename, project`. Readers resolve the row, then read the body at
`object_key`. Two write families exist:

1. **Direct sessions** (`direct-uploads.ts`): client sends parts to signed S3
   URLs. Tools verifies stored bytes and inserts the row in one transaction.
   This path only creates. Key is `transfers/<artifact_id>`.
2. **Legacy multipart/chunk** (`fetch-app.ts` -> `postgres-storage.ts`): the
   body goes through Tools, then one `PutObject`. A durable journal
   (`artifacts.operations`) protects the S3-then-PG sequence. This path owns
   HTML replacement today.

### Key concepts

- **Session row** (`artifacts.upload_sessions`): `session_id` = client
  `requestId`; `artifact_id` unique, random, and the source of the body key;
  `state` in creating, uploading, completing, completed, aborted, failed;
  durable `parts` digests and `manifest` before S3 completion.
- **Advisory session lock**: `pg_try_advisory_xact_lock` per session on a
  separate pool. It serializes create, sign, complete, abort, cleanup.
  Contention returns 409 `upload_busy` (clients retry).
- **Journal** (`artifacts.operations`): unique index on `artifact_id`, so only
  one legacy mutation per artifact can be pending. Lease 6 h. Recovery on any
  read or write re-checks the stored body's S3 `sha256` metadata, then upserts.
- **Key layout**: `pages/<id>.html` (legacy HTML), `files/<id>` (legacy file),
  `transfers/<id>` (direct). `htmlKey`, `temporaryFileKey` live in
  `storage.ts`. `transfers/` is spelled separately in `direct-uploads.ts:39`
  and `storage.ts:536`.

### How it works

- **Direct create**: reserve row (capacity lock) -> lock -> S3
  CreateMultipartUpload -> sign parts -> complete: ListParts -> durable
  manifest -> CompleteMultipartUpload if HEAD misses -> stream SHA-256 verify
  -> link re-check -> `insert into objects` + `state=completed` in the lock
  transaction. Repeat returns the receipt.
- **Legacy replace** (`PUT /api/uploads/:id`, `PUT /api/external-uploads/:id`):
  stage body to local disk -> `getHtml(headOnly)` to read S3 ETag ->
  `putHtml`: journal `put_html` with `objectKey = current.object_key` ->
  `PutObject` **in place** with `IfMatch` -> unconditional `upsert`.
- **Delete**: journal `delete` -> delete `files/<id>`, `pages/<id>.html`,
  `transfers/<id>` -> delete row.
- **File GET**: capability and expiry check -> 307 to a signed URL. MP4 uses
  stored headers. Every other type is signed with attachment disposition and
  `application/octet-stream`. Streaming fallback is always attachment.
- **HTML GET**: stream with sandbox CSP and favicon injection. ETag derives
  from row `sha256`.

### Where things live

| Concern | File |
| --- | --- |
| Session state machine | `services/tools/publisher/src/direct-uploads.ts` |
| Session wire parsing, responses | `services/tools/publisher/src/direct-upload-request.ts` |
| S3 multipart and byte verify | `services/tools/publisher/src/multipart-storage.ts` |
| Journal, pointer upsert, delete | `services/tools/publisher/src/postgres-storage.ts` |
| Key layout, S3 bodies, presign | `services/tools/publisher/src/storage.ts` |
| Routes, file delivery, legacy upload | `services/tools/publisher/src/fetch-app.ts` |
| Disposition helpers | `services/tools/publisher/src/file-metadata.ts` |
| Schema | `services/tools/database/postgres-schema.ts` |
| Browser Replace button | `services/tools/publisher/ui/manage-page.tsx:221` |
| Fleet client | `fleet: skills/file-upload/scripts/upload.py` |

### Gotchas (defects and constraints found)

1. **In-place overwrite.** Legacy replace writes at `current.object_key`. If a
   direct replacement moves the pointer to an immutable version key, the next
   legacy PUT overwrites that version. The legacy writer must change before
   or with direct replacement.
2. **Unconditional recovery.** `reconcileOperation` upserts when the stored
   sha matches. An old pending `put_html` can move the pointer back over a
   newer commit.
3. **`artifact_id` is unique.** A replacement cannot put the target ID there.
   It can use the column as its staging identity, which keeps the body-key
   derivation and lost-create cleanup unchanged.
4. **Delete knows three fixed keys only.** Version keys would survive delete,
   and the backfill or a journal could find them later.
5. **Silent fallback on old servers.** An old server ignores an unknown
   `targetId` and creates a new page. The Fleet client must fail when
   `response.id != targetId`. Deploy the server before distributing Fleet.
6. **Fleet PDF type.** `content_type(source, temporary=True)` sends
   `application/octet-stream`. `--expires-in` forces `temporary`. Retained PDFs
   uploaded that way have an octet-stream row type.
7. **Five URL builders** (`direct-upload-request.ts:56`, `fetch-app.ts:952,
   1101, 1142, 1725`). A `downloadUrl` would become a sixth hand-synced list.
8. Production always uses `createPostgresUploadStorage`
   (`services/tools/src/runtime.ts:98`). The S3-only `ifMatch` path has no
   production caller once the pointer is conditional.

### Files read

Skill: `architect/SKILL.md`, `references/runner-prompt.md`,
`design-red-flags.md`, `rationale-template.md`, `how/SKILL.md` (head).
Repo: `AGENTS.md`, `README.md`, `docs/tools-platform/README.md`,
`runtime-boundaries.md`, `direct-transfers.md`, publisher `README.md`,
`package.json`, `src/direct-uploads.ts`, `src/direct-upload-request.ts`,
`src/multipart-storage.ts`, `src/postgres-storage.ts`, `src/storage.ts`
(interface, putHtml, getHtml, presign, deleteUpload, keys), `src/fetch-app.ts`
(direct mount, replace and delete routes, file and HTML delivery, legacy upload
update), `src/index.ts`, `src/artifact-backfill.ts`,
`src/direct-upload-script.ts`, `scripts/upload-direct.ts`,
`test/direct-uploads.integration.test.ts` (harness, case list, HTML case),
`ui/manage-page.tsx` (replace), `database/postgres-schema.ts` (artifacts),
`services/tools/src/runtime.ts` (wiring), brief and `decisions.tsv`.
Fleet `origin/main`: `skills/file-upload/scripts/upload.py` (classification,
direct, replace), `references/replace-html.md`.

---

## 2. Problem

Native HTML create and replace must use direct sessions. Create already works
server-side. Replace does not exist on sessions. The obvious shape (session
with `artifact_id = target`, key `transfers/<target>`) fails: the column is
unique, the key would be reused, and the in-place legacy writer, journal
recovery, and delete would each clobber, resurrect, or leak content.
Constraints: keep IDs, URLs, flags, buttons, retained bytes and metadata,
historical readers, limits, and auth boundaries. Keep legacy routes until
callers are accounted for. No bulk rewrite of stored files. PDF must render
inline where supported and offer an explicit download. HTML stays protected.

---

## 3. Usage (caller's view)

### README excerpt (direct-transfers.md, replace section)

> To replace an HTML page, add `"targetId": "<id>"` to session creation.
> `kind` must be `"html"`. Parts, status, abort, and completion are unchanged.
> The server records the page's current version when it creates the session.
> Completion commits only if the page still has that version. If another
> write landed first, completion returns 409 `replace_conflict` and nothing
> changes. Do not retry that error automatically; start a new replacement to
> overwrite the newer page. Completion returns 200 with the target `id` and
> URL. Omit `project` to keep the page's project at commit time.
>
> Files: the canonical URL shows PDFs inline where the browser supports it.
> `downloadUrl` (canonical URL plus `?download=1`) always downloads.

### Call site 1: Fleet `upload.py --replace-id <id> page.html`

```python
initialized = control(root, {"requestId": request_id, "filename": source.name,
    "contentType": "text/html", "totalBytes": size, "kind": "html",
    "targetId": replace_id, **({"project": project} if project else {})})
# ... unchanged part loop ...
response = control(f"{session_url}/complete")          # 200
if response.get("id") != replace_id:                    # old server ignored targetId
    raise UploadError("server did not replace the requested page")
if response.get("sha256") != local_digest: raise UploadError("digest mismatch")
# 409 replace_conflict -> UploadError("page changed since this replacement started; rerun to overwrite")
```

HTML create is the same call without `targetId` (completion 201). The printed
request ID resumes both.

### Call site 2: server, inside `complete()` for a replace session

```ts
const commit = await commitHtmlVersion(tx,
  { id: target.targetId, expectedObjectKey: target.expectedObjectKey },
  { objectKey: bodyKey(target), filename, bytes: totalBytes, sha256, project });
switch (commit.outcome) {
  case "committed": /* state=completed, superseded=commit.superseded */ break;
  case "conflict": throw replaceConflict();   // terminal, session -> failed
  case "missing":  throw unavailable();       // terminal, session -> failed
  case "busy":     throw uploadBusy();        // retryable, state unchanged
}
```

### Call site 3: server, legacy `putHtml` replacing an existing page

```ts
const current = await find(sql, id, "html");
const objectKey = current ? versionKey(id, newVersionId()) : htmlKey(id);
// journal payload carries expectedObjectKey = current?.object_key
// PutObject to the fresh key (no IfMatch), then in the journal-owned tx:
const commit = await commitHtmlVersion(tx, { id, expectedObjectKey: current.object_key }, next, operation);
if (commit.outcome !== "committed") throw new HtmlUpdateConflictError();  // existing 409 mapping
```

### Call site 4: file delivery

```ts
const delivery = fileDelivery(metadata, url.searchParams.get("download") === "1");
const signed = await storage.presignTemporaryFile(id, seconds, delivery);
```

---

## 4. Shape

### Wire contract (exact, additive)

Session creation `POST /api/uploads/sessions` (native bearer) and
`POST /api/external-uploads/sessions` (browser session, only when
`browserPersistentUpload` allows HTML). Drop routes reject `targetId` with 400.

```json
{ "requestId": "<uuid>", "filename": "page.html", "contentType": "text/html",
  "totalBytes": 1234, "kind": "html", "targetId": "<32 char [A-Za-z0-9_-]>",
  "project": "optional" }
```

| Case | Status | `error` | Retry |
| --- | --- | --- | --- |
| `targetId` without `kind:"html"`, bad format, or on drop route | 400 | `invalid_upload` | no |
| target missing, revoked, or not HTML (init, sign, status, complete) | 404 | `upload_not_found` | no |
| same `requestId`, different description or `targetId` | 409 | `upload_conflict` | no |
| journaled legacy write or delete holds the target at commit | 409 | `upload_busy` | yes (existing client loop) |
| pointer no longer at the expected key | 409 | `replace_conflict` | **no** |

Session view response: unchanged. Replace completion: **200**
`{ id: targetId, kind: "html", filename, contentType, bytes, sha256, url,
project? }`. Repeated completion returns the same body and status. File
completion and listing items gain `downloadUrl`. Files accept
`GET|HEAD /files/:id/:filename?download=1`. Any other query is ignored as today.

### Schema (exact, additive, `postgres-schema.ts` `uploadSessions`)

```ts
targetId: text("target_id"),
expectedObjectKey: text("expected_object_key"),
superseded: jsonb("superseded").$type<SupersededVersion>(),
// table extras:
check("upload_sessions_replace_check", sql`(${table.targetId} is null) = (${table.expectedObjectKey} is null)
  and (${table.superseded} is null or ${table.targetId} is not null)`),
index("upload_sessions_target_idx").on(table.targetId).where(sql`${table.targetId} is not null`),
```

Generated DDL is `alter table add column` (nullable, no default, no rewrite)
plus `add constraint` and `create index`. Old code ignores the columns. Retain
them on rollback. No change to `objects` or `operations`. The journal payload
gains an optional JSON field `expectedObjectKey`.

### Types and signatures

```ts
// storage.ts : the one owner of key layout
export function htmlKey(id: string): string;                 // pages/<id>.html (unchanged)
export function temporaryFileKey(id: string): string;        // files/<id>      (unchanged)
export function transferKey(id: string): string;             // transfers/<id>
export function versionKey(targetId: string, versionId: string): string; // transfers/<targetId>/<versionId>
export function newVersionId(): string;                      // 24 random bytes, base64url (32 chars)
/** Deletes fixed keys, every object under transfers/<id>/, and aborts every
 * multipart upload under that prefix. Idempotent; the delete journal retries it. */
deleteUpload(id: string, options?: StorageOperationOptions): Promise<void>;

export type FileDelivery =
  | { kind: "media" }                                            // MP4 playback, stored headers
  | { kind: "inline"; filename: string; contentType: "application/pdf" }
  | { kind: "attachment"; filename: string };
presignTemporaryFile?(id: string, seconds: number, delivery: FileDelivery,
  options?: StorageOperationOptions): Promise<string | null>;  // delivery now required
// PutHtmlOptions.ifMatch: deleted (no caller after fresh-key writes).
```

```ts
// html-versions.ts (new, not exported from index.ts)
export type HtmlBody = { objectKey: string; filename: string; bytes: number; sha256: string; project?: string };
export type SupersededVersion = { objectKey: string; filename: string; bytes: number;
  sha256: string | null; project: string | null; updatedAt: string };
export type HtmlCommit =
  | { outcome: "committed"; project: string | null; superseded: SupersededVersion }
  | { outcome: "conflict" | "missing" | "busy" };

/** The only writer that moves an HTML artifact to another body.
 * Invariants: the caller staged and verified `next.objectKey`, a key no row has
 * ever referenced. This function never deletes or reuses a key.
 * In one transaction: lock the objects row FOR UPDATE (missing if absent,
 * revoked, or not html); return busy if artifacts.operations has a row for the
 * target other than `journal`; return conflict if object_key <> expected;
 * else set object_key, filename, bytes, sha256, content_type,
 * project = coalesce(next.project, project), updated_at = now(), and return
 * the prior row as `superseded`. */
export async function commitHtmlVersion(tx: TransactionSql,
  target: { id: string; expectedObjectKey: string }, next: HtmlBody,
  journal?: OperationOwner): Promise<HtmlCommit> { throw new Error("not implemented"); }
```

```ts
// direct-uploads.ts
export type DirectUploadIntent = { kind: "create" } | { kind: "replace"; targetId: string };
/** Parsed from the row at load(). Wire and column names stay private. */
type SessionBody =
  | { kind: "create"; artifactId: string }                                   // key transferKey(artifactId)
  | { kind: "replace"; targetId: string; versionId: string; expectedObjectKey: string }; // key versionKey(...)
function bodyKey(body: SessionBody): string;          // the only key derivation for sessions
function canonicalId(body: SessionBody): string;      // targetId ?? artifactId

export type DirectUploadResult = DirectUploadDescription & { id: string; sha256: string; replaced: boolean };
create(requestId: string, owner: DirectUploadOwner, description: DirectUploadDescription,
  intent: DirectUploadIntent, maxSessions: number, signal: AbortSignal): Promise<DirectUploadSession>;
// status, sign, complete, abort, cleanup, close: signatures unchanged.
```

```ts
// file-metadata.ts
export function contentDisposition(kind: "inline" | "attachment", name: string): string; // replaces attachmentDisposition
/** application/pdf, or application/octet-stream named *.pdf, renders inline
 * unless download is requested. MP4 stays media. Everything else attaches. */
export function fileDelivery(file: { contentType: string; originalName: string }, download: boolean): FileDelivery;
export function artifactUrls(baseUrl: string, artifact: { id: string; kind: "html" | "file"; filename: string }):
  { url: string; downloadUrl?: string };              // all five builders call this
```

### Data flow (replace)

`direct-upload-request.ts` parses `targetId` into `DirectUploadIntent` ->
`create()` reservation transaction reads the target row (`kind='html'`,
`revoked_at is null`) and inserts the session with `artifact_id =
newVersionId()`, `target_id`, `expected_object_key = row.object_key` ->
multipart at `versionKey` -> `complete()` verifies bytes exactly as today ->
`commitHtmlVersion` in the lock transaction -> `state=completed`,
`superseded` stored -> response built by `artifactUrls`.

### Load-bearing decisions

- **Version token is `object_key`** (per model-the-domain). Keys are unique
  (DB constraint) and, after this change, immutable. No counter column, no
  second writer to keep in sync.
- **One pointer writer** (per encode-lessons-in-structure, split ownership).
  Direct, legacy, and journal recovery all go through `commitHtmlVersion`.
- **Expected version captured server-side at init** and stored durably. A
  resumed or restarted client cannot widen it. The client never sends it.
- **Commit is UPDATE, never upsert**, for replacement. A deleted target cannot
  come back.
- **Prior bodies stay** under `transfers/<id>/` until the artifact is deleted.
  In-flight reads of the prior key keep working during the swap.
- **Delete enumerates by prefix**, not by history rows. Lost or pruned rows
  cannot hide an owned key.
- Interface depth: the wire grows by one optional field. Callers do not learn
  staging IDs, keys, expected versions, or journal rules.

---

## 5. Lifecycle, recovery, and legacy writers

### Replace session states

| Event | Session | Staged key `transfers/<t>/<v>` | Pointer |
| --- | --- | --- | --- |
| init, lost response, re-init same ID | creating -> uploading | multipart created once | unchanged |
| sign, PUT, lost PUT response | uploading | parts | unchanged |
| complete: missing parts | uploading, 409 `incomplete_upload` | kept | unchanged |
| complete: bad size or bytes | failed, 422 | removed by cleanup | unchanged |
| complete: lost S3 complete or DB failure | completing | object kept | unchanged, retry verifies and commits once |
| commit conflict | failed, 409 `replace_conflict` | removed by cleanup | unchanged |
| commit busy | completing, 409 `upload_busy` | kept | unchanged |
| commit ok, repeated complete | completed (+`superseded`) | is the pointer | moved once |
| DELETE before commit | aborted | removed | unchanged |
| DELETE after commit | no-op | kept | kept |
| session expiry | aborted by cleanup | removed | unchanged |
| target deleted | `active()` -> 404, then failed | removed by artifact delete and cleanup | row gone |
| restart | locks released | durable state | resume from row |

Guards added to `direct-uploads.ts`:

- `active()` also requires a live HTML target for replace sessions.
- Abort and cleanup call `bucket.remove(key)` only when no `objects` row has
  `object_key = key`. A referenced key is logged as an invariant failure and
  never deleted.
- Receipt pruning keeps completed replace receipts while their target exists:
  add `and (target_id is null or state <> 'completed' or not exists (select 1
  from artifacts.objects o where o.id = target_id))`. The `superseded`
  snapshot is the recovery record for a single-page rollback.

### Delete and revoke race

Delete journals first, deletes keys, then deletes the row. A direct commit
between those steps sees the journal row and returns `busy`. A commit that
checked before the journal row existed finished its S3 completion earlier, so
the prefix listing deletes its key, and `finalizeDelete` removes the row. No
path re-inserts a row. A staged body completed after the listing belongs to a
session whose commit fails with `missing`. Cleanup then removes that body.

### Legacy writer plan

| Writer | Change in this release | Removal criterion |
| --- | --- | --- |
| Native `PUT /api/uploads/:id` (old Fleet) | `putHtml` writes `versionKey(id, newVersionId())`, journals `expectedObjectKey`, commits through `commitHtmlVersion`. Response unchanged. ETag capture and `IfMatch` deleted. | Caller register shows every declared Fleet device and harness on the new skill, and route observation shows no calls. |
| Browser `PUT /api/external-uploads/:id` | Same storage path, so safe for loaded bundles. Recommended: the Replace button moves to a direct session with `targetId`. | Old bundles aged out, no route calls. |
| Native `POST /api/uploads` HTML create (old Fleet) | None. New IDs use `pages/<id>.html`. | Same as native replace. |
| Chunk routes | None. They create files only and never touch HTML pointers. | Brief's local legacy-chunk drain proof plus caller register. |
| Journal records written by old code | Recovery upsert gains `where objects.object_key = excluded.object_key`. Absent `expectedObjectKey` means create or old in-place write: insert if absent, update only at the same key. Present means `commitHtmlVersion`. | Delete the branch and the JSON-string decoder once no pre-deploy records remain. |

A losing legacy write leaves its fresh body under the prefix. Delete removes
it with the artifact. This keeps one deletion owner and adds no single-key
delete method.

### PDF delivery

| Request | Delivery | Signed URL overrides | Streaming fallback header |
| --- | --- | --- | --- |
| PDF, no `download` | inline | `response-content-disposition=inline; filename=...`, `response-content-type=application/pdf`, `private, no-store` | `inline`, `application/pdf`, `nosniff` |
| any file, `?download=1` | attachment | as today | `attachment` |
| MP4, no `download` | media | none (as today) | as today |
| other | attachment | as today | as today |

The capability, expiry, range, HEAD, and conditional rules stay the same. HTML
keeps the sandbox CSP and favicon streaming. The publisher UI gets a Download
button for files, from `downloadUrl`. Fleet prints `downloadUrl` for files.

---

## 6. Module map

| File | Change |
| --- | --- |
| `database/postgres-schema.ts` | 3 columns, 1 check, 1 partial index |
| `publisher/src/html-versions.ts` | new, `commitHtmlVersion` (about 60 lines) |
| `publisher/src/direct-uploads.ts` | `SessionBody`, `bodyKey`, intent at create, target-aware `active()`, commit branch, referenced guard, prune predicate |
| `publisher/src/direct-upload-request.ts` | parse `targetId`; status 200 for replace; `artifactUrls` |
| `publisher/src/postgres-storage.ts` | fresh-key replace, journal `expectedObjectKey`, conditional recovery upsert |
| `publisher/src/storage.ts` | `transferKey`, `versionKey`, `newVersionId`, prefix-aware `deleteUpload`, `FileDelivery`, delete `ifMatch` |
| `publisher/src/file-metadata.ts` | `contentDisposition`, `fileDelivery`, `artifactUrls` |
| `publisher/src/fetch-app.ts` | file route uses `fileDelivery`; legacy upload drops ETag capture; URL builders call `artifactUrls` |
| `publisher/ui/manage-page.tsx`, `ui/direct-upload.ts` | Download button; optional direct Replace |
| `docs/tools-platform/direct-transfers.md`, publisher `README.md` | replace protocol, PDF, removal criteria; delete "HTML replacement preserves its current object key" |
| Fleet `skills/file-upload/scripts/upload.py`, `references/*.md`, `tests/test_upload.py` | HTML create and replace through sessions, `id == targetId` check, `replace_conflict` not retried, print `downloadUrl`, send guessed PDF type even when temporary |

Server owner holds every Microservices file. Fleet owner holds every Fleet
file. The wire contract above is their only shared surface.

---

## 7. Synthesis decision (candidate selection)

Base: A. It reuses the session table, its lock, its lost-create recovery, and
its byte verification without a second state machine. The decisive fact is
that `artifact_id` already works as a staging identity, so the new state is
three columns, and the only new concept is the conditional pointer move. From
the ledger alternative (B), A keeps the idea of a durable prior-version
snapshot, but stores it on the receipt. From the copy alternative (C), A keeps
nothing. From the sub-resource alternative (D), A keeps the rule that the
target ID is fixed at session creation.

## 8. Red-flag screen

| Flag | A |
| --- | --- |
| Shallow module | `commitHtmlVersion` hides locking, journal check, condition, snapshot behind one call. Pass |
| Information leakage | Key layout only in `storage.ts`. Wire `targetId` parsed into `DirectUploadIntent`. Pass |
| Temporal decomposition | Lifecycle stays in one session module. Pass |
| Pass-through | None added. Pass |
| Split ownership | HTML pointer moves: one writer. Row creation still has two writers (pre-existing). Noted |
| Two ways to do one task | Replace commit: one way. Replace transport: direct plus legacy multipart, legacy kept only under a named removal criterion. Accepted |
| Importable internals | `html-versions.ts` not exported from `index.ts`. Pass |
| Hand-synced list | Five URL builders collapse into `artifactUrls`. Fixed keys and prefix in one function. Pass |

## 9. Tradeoffs accepted

- We accept that `upload_sessions.artifact_id` means "body identity" (version
  ID for replace) in exchange for a purely additive schema and unchanged key
  derivation and lost-create cleanup.
- We accept unbounded retention of superseded HTML bodies until artifact
  deletion in exchange for race-free reads and recoverable prior versions.
  HTML size limits bound each version.
- We accept that legacy replacements record no `superseded` row (their S3
  metadata keeps name, size, sha, project) in exchange for no ledger table.
- We accept that a conflict loses the uploaded body and needs a new
  replacement, in exchange for never clobbering a newer write.
- We accept one prefix listing per delete in exchange for delete that does
  not depend on history rows.
- We accept inline PDF for octet-stream rows named `*.pdf` in exchange for
  inline retained PDFs without metadata rewrites.

## 10. Alternatives considered

- **B. Version ledger.** New `artifacts.html_versions` table plus
  `objects.revision` token; every commit writes the ledger, delete reads it.
  Uniform history for all writers, but two tables must stay in sync, every
  writer bumps a counter, and delete still needs the prefix for staged and
  orphan bodies. Larger surface, same guarantees. Lost.
- **C. Stable key with server-side copy.** Stage, then `CopyObject` onto the
  current key with `If-Match`, then update metadata. Keeps `object_key`
  stable, but destroys the prior body, splits one change across S3 and
  PostgreSQL with no atomic point, shows new bytes with old metadata during
  the gap, and relies on unproven Railway conditional-copy behavior. Lost.
- **D. Replacement sub-resource.** `POST /api/uploads/:id/replacements` with
  its own parts, complete, and abort routes and table. Clear REST shape, but it
  duplicates the session lifecycle (two ways to run a session) and doubles the
  Fleet transport code. Lost.
- Point variant inside A: a `revision bigint` token. Lost because every writer
  must bump it, and `object_key` already identifies the version uniquely.

## 11. Testing seams

Pure (fast, no resources): `fileDelivery` decision table; `artifactUrls`;
`targetId` parsing and error codes in `handleDirectUpload` with a fake
`DirectUploads`; `fetch-app.test.ts` redirect overrides, `?download=1`, HEAD
headers, and signing-failure fallback for PDF.

Real resources: the parent's owned native PostgreSQL 16 (with the disposable
sentinel) and RustFS 1.0.1 (`tools-transfer-test`) on loopback. Do not use
Docker. Use the `verify-tools` skill for browser and CLI evidence against the
running Tools. RustFS proves the S3 contract locally. It does not prove
Railway storage behavior (see open question 5).

1. Direct HTML create, then direct replace. Read raw bytes with S3 GetObject
   at the new key and at the prior key; compare sha independently of favicon.
   URL and ID unchanged, ETag changed, project kept.
2. Lost S3 completion and a trigger that rejects `update` on `objects`; retry
   commits exactly once.
3. Repeat completion after a later second replacement returns the first receipt.
4. Two sessions on one target: first commits, second gets `replace_conflict`,
   pointer unchanged, staged key gone after cleanup. Same with `Promise.all`.
5. Legacy PUT during a direct session makes the direct commit conflict. Legacy
   PUT after a direct commit writes a fresh key; the direct version's bytes are
   unchanged.
6. Old-format journal record (no `expectedObjectKey`, JSON string) recovered
   after a direct commit does not move the pointer.
7. Delete during upload: sign and complete return 404; prefix holds no objects
   and no multipart uploads; no row after cleanup and recovery.
8. Delete after three replacements removes every version and fixed key.
9. Project change between init and commit survives a replace without `project`.
10. Restart (`attach()`) between each step. Abort before and after commit.
11. PDF: storage returns `inline` and `application/pdf` through the signed URL;
    `?download=1` returns attachment.
12. Application body bytes stay at control-JSON size (existing counter).

Fleet: fake-server tests for session replace, `id` mismatch failure,
`replace_conflict` not retried, digest check, request ID resume. Real CLI
against isolated Tools for create, replace, PDF.

## 12. Release seams

1. Paired database and bucket backup, isolated restore check, manifests.
2. One Railway deployment. Predeploy applies the additive DDL. Max pauses
   uploads for the window: an old instance still overlapping could overwrite a
   version key in place.
3. After the server is live, scoped Fleet distribution of the skill only. Old
   clients keep working through the now-safe legacy routes, so an offline
   device does not block this release. It blocks only legacy removal.
4. Rollback: old code reads `transfers/<t>/<v>` pointers correctly. Old code
   cannot complete pending replace sessions (fails safe) and its cleanup leaves
   their staged multipart under the prefix until roll-forward or artifact
   delete. After rollback, do not replace HTML until roll-forward.

## 13. Open questions

1. Move the browser Replace button to a direct session in this PR? Recommended
   yes (about 15 UI lines, removes browser body egress). Owner: Max.
2. Inline PDFs stored as octet-stream when named `*.pdf`? Recommended yes.
   Owner: Max.
3. Keep every superseded HTML body until artifact deletion, with no version
   pruning? Recommended yes. Owner: Max.
4. Lift Fleet's "`--request-id` is only for temporary file creation" rule for
   HTML create and replace? Owner: Fleet implementer, Max to accept.
5. Does Railway storage honor `response-content-disposition=inline` on signed
   GET? Needs approved non-production bucket proof. Owner: release preparer.
6. Does Chrome's PDF viewer render the Tools-origin streaming fallback with
   the current headers? Needs browser evidence. Owner: server implementer.

## 14. Next implementation step

Add the schema columns and `html-versions.ts` with `commitHtmlVersion`, then
write integration cases 4 and 6 against it before touching the session code.
