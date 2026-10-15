# Artifact Publisher

Artifact Publisher stores self-contained HTML plans and shared downloads in
a private S3-compatible bucket. Production routes are mounted by
`services/tools`; unguessable delivery URLs are public, unlisted read
capabilities, while management routes use the Tools browser session or native bearer authentication.

- Canonical HTML URLs are `/artifacts/:id`.
- Canonical file URLs are `/files/:id/:filename`.
- Capability delivery supports unauthenticated `GET` and `HEAD` only.
- HTML persists until revoked.
- Other files expire after three days by default. The artifact console can set
  an exact future expiry or keep a file until it is revoked.
- `/api/uploads*` requires the native upload bearer token and intentionally
  does not require a browser session.
- `/publisher` and `/api/external-uploads` are available only through the unified
  platform's browser session boundary.
- `/api/upload-links` creates and revokes time-limited guest upload capabilities.
- `/drop/:token` lets a guest upload any number of temporary files without a
  browser session. PostgreSQL stores only the token hash; the secret URL is
  returned once, expires after 5 minutes to 30 days, and can be revoked early.

## Configuration

Required:

- `UPLOAD_TOKEN`
- `S3_BUCKET`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Public URL selection:

- `PUBLIC_BASE_URL`, an explicit HTTP(S) origin
- `RAILWAY_PUBLIC_DOMAIN`, an HTTPS hostname fallback

Production startup requires one of those public URL values. Optional safeguards
are `MAX_UPLOAD_BYTES`, `MAX_HTML_UPLOAD_BYTES`, `MAX_CONCURRENT_UPLOADS`,
`TEMPORARY_FILE_RETENTION_MS`, `TEMPORARY_FILE_CLEANUP_INTERVAL_MS`, and
`S3_FORCE_PATH_STYLE`. Numeric values must be positive base-10 integers.

## Direct transfers

The Fleet uploader, React console, and guest page send new file bytes directly to private storage
through durable multipart sessions. Tools authorizes short-lived URLs, verifies
actual stored bytes, and commits canonical metadata in PostgreSQL. Interrupted
uploads can resume after web sleep or restart without local chunk files.

Native agents can use `pnpm upload:direct <file> [request-id]` with
`PUBLIC_BASE_URL` and `UPLOAD_TOKEN`, or `/api/uploads/sessions`. Browser session
routes use `/api/external-uploads/sessions`; guest routes use
`/api/drop/:token/uploads/sessions`. HTML replacements use the same direct protocol with
a replacement target. Each replacement stages a new immutable body. Tools verifies its
stored size and SHA-256, then conditionally changes the canonical pointer. The ID, URL,
creation time, and omitted project stay unchanged. Prior bytes and full replacement
receipts remain available for recovery. No bucket credential is sent to a client.

See [direct transfers](../../../docs/tools-platform/direct-transfers.md) for the
protocol, integrity validation, limits, recovery, retained caller compatibility,
CORS configuration, and unapplied production rollout steps.

## Native compatibility API

The endpoint accepts exactly one file field named `file` and an optional
`project` field for persistent HTML plans:

```bash
curl -fsS -X POST "$PUBLIC_BASE_URL/api/uploads" \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  --form-string "project=my-project" \
  -F "file=@page.html;type=text/html"
```

An upload is HTML only when its extension is `.html` or `.htm` and its MIME
type is `text/html` or `application/xhtml+xml`. Everything else is a temporary
download. Uploads are staged on local temporary storage, hashed, and sent with
one S3 `PutObject`. The HTML cap is enforced while staging. Project names are
normalized, limited to 240 UTF-8 bytes, stored with plans, and returned by the
upload and inventory APIs. Replacing a plan preserves its stored project when
the update omits `project`.

Replace an HTML page without changing its ID:

```bash
curl -fsS -X PUT "$PUBLIC_BASE_URL/api/uploads/$UPLOAD_ID" \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -F "file=@revised-page.html;type=text/html"
```

Revoke either object type idempotently:

```bash
curl -fsS -X DELETE "$PUBLIC_BASE_URL/api/uploads/$UPLOAD_ID" \
  -H "Authorization: Bearer $UPLOAD_TOKEN"
```

Set an exact future expiry on a file with the same native bearer credential.
Send an ISO timestamp in UTC; the response returns the saved expiry. This
also works after a chunked native upload. An HTML plan cannot be given an
expiry through this route.

```bash
curl -fsS -X PATCH "$PUBLIC_BASE_URL/api/uploads/$UPLOAD_ID" \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"expiresAt":"2026-10-01T12:00:00.000Z"}'
```

Legacy native file uploads retain the chunk protocol under
`/api/uploads/chunks`. Every request retains the native bearer credential:

```http
POST /api/uploads/chunks
Authorization: Bearer <upload token>
Content-Type: application/json

{"filename":"backup.bin","contentType":"application/octet-stream","totalBytes":262144000,"totalChunks":13,"chunkBytes":20971520}
```

Send each raw chunk with `PUT /api/uploads/chunks/:sessionId/:index`, then call
`POST /api/uploads/chunks/:sessionId/complete`. Use `DELETE
/api/uploads/chunks/:sessionId` to abandon a session. The bearer token is
required for all four operations. Chunked native uploads create temporary
files; Legacy clients can still replace HTML through the multipart endpoint. Current
Fleet and browser replacements use direct sessions.

The authenticated browser console changes a file's expiry through the
same-origin lifecycle route. An ISO timestamp must be in the future. `null`
makes the file permanent:

```http
PATCH /api/external-uploads/:id
Content-Type: application/json

{"expiresAt":"2026-08-30T12:00:00.000Z"}
```

```http
PATCH /api/external-uploads/:id
Content-Type: application/json

{"expiresAt":null}
```

## Browser and read behavior

The unified `/publisher` UI creates temporary files, while `/publisher/artifacts` owns the
artifact inventory and lifecycle actions
through same-origin `/api/external-uploads`. The Better Auth session is
validated at the platform boundary; the browser never receives the native
upload token.

The same page can create a guest upload link for 1 hour, 1 day, 3 days, 7 days,
or 30 days. Link management stays session-protected. The guest page and its
upload requests are public capability routes; multiple selected files are sent
sequentially through durable direct sessions. Guest pages
cannot list prior uploads. Received files use
at least the link lifetime for retention and appear in the authenticated
library. The owner can stream every still-retained file received through one
link as a ZIP64 archive, including after revoking that link.
The private upload-link history loads 20 newest-first rows at a time through an
opaque keyset cursor, with older rows available on demand.

The current browser uses direct sessions for small and large files. Legacy
browser multipart/chunk routes remain for already loaded bundles during rollout;
the native chunk protocol remains for observed external callers. Those paths
retain local staging and their existing two-hour session limit.

`GET /api/external-uploads` accepts `kind=all|html|file`, a normalized
case-insensitive filename `q`, `expiry=all|24h|7d|persistent`, and
`sort=newest|oldest|filename|expiry`. Filtering and sorting cover the complete
candidate set before pagination. Cursors are opaque versioned positions bound
to normalized criteria; changing any criterion requires a fresh listing.
The `persistent` filter returns HTML artifacts and files with no expiry.
Passing `includeSummary=true` on the first page also returns exact inventory
counts for total, permanent, temporary, expiring-soon, and project membership.
Those counts cover the complete retained inventory and are independent of the
page size; continuation requests omit the summary so loading older rows does
not repeat the aggregate work.
Recent-upload destinations on the current browser origin use an internal
chevron and open in the current tab. Cross-origin destinations use an external
arrow, open in a new tab with `rel=noreferrer`, and include an accessible
new-tab announcement.
Unversioned `/publish|uploads/app.css|app.js` aliases are private `no-store`;
only versioned `/publish|uploads/assets/:version/app.css|app.js` responses use
private one-year immutable caching.

HTML is streamed from the private bucket with sandbox, no-referrer, no-sniff,
and no-index headers. Delivery adds the Publisher favicon to HTML responses
without changing the stored artifact. File downloads support `HEAD` and
one standard byte range. Missing, revoked, and expired capability URLs return
`404`. Malformed canonical or legacy percent encoding returns `404`.

Non-conditional file `GET` requests of every size use a
temporary signed object-storage URL after the canonical capability is checked.
PDFs use inline disposition and application/pdf so the browser can display them. This
also applies to retained files with a .pdf filename and binary metadata. The explicit
Download control adds ?download=1 and requests attachment disposition. Other non-video
files use attachment disposition and a binary content type. All signed reads use private
no-store caching. The redirect is `private, no-store`; its signed
storage URL is valid for at most four hours (less near file expiry) so playback
and later seeks can use the same URL. A client following the redirect
receives full and byte-range responses from storage instead of sending
those bytes through the Tools service. `HEAD`, conditional requests, and requests
with `If-Range` retain the canonical service response. If signing fails, the
original service response is used. Revoking a capability
stops new redirects and deletes the object, invalidating previously signed
URLs once storage processes the deletion. Shortening an existing file's expiry
does not revoke a URL already issued for the earlier expiry. Production CDN
configuration leaves HTML caching disabled; the signed redirect itself is
never shared-cacheable.

The private S3-compatible bucket needs a CORS rule permitting `GET` and `HEAD`
from any origin, with request headers including `Range` and exposed response
headers including `Content-Range`. This preserves playback from sandboxed
artifact pages, whose origin is opaque, while every object read still requires
a valid short-lived signature. The production Tigris bucket has this rule.

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Accept-Ranges", "Content-Range", "Content-Length", "Content-Type", "ETag"],
    "MaxAgeSeconds": 300
  }]
}
```

Errors use JSON with stable `error` and `message` fields. Notable statuses are
`401 unauthorized`, `403 invalid_origin`, `404 upload_not_found`, `408
upload_timeout`, `409
upload_conflict`, `409 incomplete_upload`, `413 payload_too_large`, `415
unsupported_media_type`, `416
range_not_satisfiable`, and `503 upload_capacity_reached`.

## Cleanup

Cleanup checks each expiring file at startup and at the configured
interval without overlapping sweeps. A failure on one object does not stop
later cleanup work. Files with no expiry remain until revoked. Production
cleanup runs at startup and on the existing hourly schedule. It also aborts expired
or abandoned direct multipart sessions; active sessions survive web sleep.
