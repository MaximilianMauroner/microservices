# Artifact Publisher

Artifact Publisher stores self-contained HTML plans and temporary downloads in
a private S3-compatible bucket. Production routes are mounted by
`apps/platform-service`; unguessable delivery URLs are public, unlisted read
capabilities, while upload/list/revoke surfaces use the Publisher Cloudflare
Access audience or native bearer authentication.

- Canonical HTML URLs are `/artifacts/:id`; legacy `/p/:id` aliases redirect.
- Canonical file URLs are `/files/:id/:filename`; legacy `/f/*` aliases redirect.
- Canonical and legacy delivery support unauthenticated `GET` and `HEAD` only.
- HTML persists until revoked.
- Other files expire after three days by default.
- `/api/uploads*` requires the native upload bearer token and intentionally
  does not require browser Access.
- `/publish` and `/api/external-uploads` are available only through the unified
  platform's browser Access adapter.

The standalone process remains available for native-token API development and
storage operations. It does not implement browser authentication, so its
browser upload routes fail closed with `503 external_upload_unavailable`.

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

## Native upload API

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

## Browser and read behavior

The unified `/publish` UI lists recent uploads and creates temporary files
through same-origin `/api/external-uploads`. Cloudflare Access is validated at
the platform route-family boundary; the browser never receives the native
upload token.

`GET /api/external-uploads` accepts `kind=all|html|file`, a normalized
case-insensitive filename `q`, `expiry=all|24h|7d|persistent`, and
`sort=newest|oldest|filename|expiry`. Filtering and sorting cover the complete
candidate set before pagination. Cursors are opaque versioned positions bound
to normalized criteria; changing any criterion requires a fresh listing.
Recent-upload destinations on the current browser origin use an internal
chevron and open in the current tab. Cross-origin destinations use an external
arrow, open in a new tab with `rel=noreferrer`, and include an accessible
new-tab announcement.
Unversioned `/publish|uploads/app.css|app.js` aliases are private `no-store`;
only versioned `/publish|uploads/assets/:version/app.css|app.js` responses use
private one-year immutable caching.

HTML is streamed from the private bucket with sandbox, no-referrer, no-sniff,
and no-index headers. Temporary downloads support `HEAD` and one standard byte
range. Missing, revoked, and expired capability URLs return `404`. Malformed
canonical or legacy percent encoding returns `404`.

Errors use JSON with stable `error` and `message` fields. Notable statuses are
`401 unauthorized`, `403 invalid_origin`, `404 upload_not_found`, `409
upload_conflict`, `413 payload_too_large`, `415 unsupported_media_type`, `416
range_not_satisfiable`, and `503 upload_capacity_reached`.

## Cleanup

Cleanup checks each object's stored expiry at startup and at the configured
interval without overlapping sweeps. A failure on one object does not stop
later cleanup work. Production cleanup runs inside the always-awake unified
platform service.
