# HTML Planning and Temporary File Publisher

Publishes self-contained HTML plans and temporary file downloads from a private Railway Storage Bucket. Every public URL contains a 192-bit random ID and should be treated as a shareable capability, not as private access control.

- HTML plans use sandboxed, browser-viewable `/p/:id` URLs and remain available until revoked.
- Other files use `/f/:id/:filename` download URLs and expire after 3 days by default.
- Upload and deletion APIs require the bearer token. Public reads do not.

## Required environment

- `UPLOAD_TOKEN`: bearer token for upload and deletion APIs
- `S3_BUCKET`: Railway bucket API name
- `S3_ENDPOINT`: HTTP(S) S3-compatible endpoint, usually `https://storage.railway.app`
- `S3_REGION`: bucket region
- `S3_ACCESS_KEY_ID`: bucket access key
- `S3_SECRET_ACCESS_KEY`: bucket secret key

Public URL selection:

- `PUBLIC_BASE_URL`: optional explicit HTTP(S) origin returned in upload responses; takes precedence when set
- `RAILWAY_PUBLIC_DOMAIN`: Railway-provided hostname used as an HTTPS fallback when `PUBLIC_BASE_URL` is unset

In production, startup requires one of these public URL values. `PUBLIC_BASE_URL` must be an origin without a path, query, credentials, or fragment; `RAILWAY_PUBLIC_DOMAIN` must be a bare valid hostname.

Optional safeguards:

- `MAX_UPLOAD_BYTES`: temporary file cap, default `5000000000` (5 GB single-PUT limit)
- `MAX_HTML_UPLOAD_BYTES`: HTML plan cap, default `25000000` (25 MB) and never greater than `MAX_UPLOAD_BYTES`
- `MAX_CONCURRENT_UPLOADS`: uploads simultaneously staged and sent to S3, default `1`
- `TEMPORARY_FILE_RETENTION_MS`: temporary file lifetime, default `259200000` (3 days), maximum `3153600000000` (100 years)
- `TEMPORARY_FILE_CLEANUP_INTERVAL_MS`: cleanup interval, default `3600000` (1 hour)
- `S3_FORCE_PATH_STYLE`: `true` or `false`; enable only when the bucket requires path-style URLs

Numeric values must be positive base-10 integers.

## Upload

The endpoint accepts exactly one multipart field named `file`. UTF-8 multipart filenames are preserved in upload responses, storage metadata, and download headers:

```bash
curl -fsS -X POST "$PUBLIC_BASE_URL/api/uploads" \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -F "file=@page.html;type=text/html"
```

An upload is classified as HTML only when its extension is `.html` or `.htm` and its MIME type is `text/html` or `application/xhtml+xml`. Everything else is a temporary download.

HTML response:

```json
{
  "id": "unguessable-token",
  "kind": "html",
  "filename": "page.html",
  "contentType": "text/html; charset=utf-8",
  "url": "https://service.example/p/unguessable-token",
  "bytes": 1234,
  "sha256": "..."
}
```

Temporary file response:

```json
{
  "id": "unguessable-token",
  "kind": "file",
  "filename": "archive.zip",
  "contentType": "application/zip",
  "url": "https://service.example/f/unguessable-token/archive.zip",
  "bytes": 12345678,
  "expiresAt": "2026-07-13T12:00:00.000Z",
  "sha256": "..."
}
```

Uploads are staged on local temporary storage, hashed, and sent with one S3 `PutObject` request. The HTML cap is enforced while staging, and partial files from rejected uploads are removed. The concurrency gate protects temporary disk from parallel 5 GB uploads, but slow large uploads can still exceed the hosting platform's HTTP timeout. A future direct-to-bucket multipart API is the appropriate path above this compatibility endpoint's operational limits.

## Read behavior

HTML pages are streamed from S3 rather than buffered in process memory. Responses include `Content-Length`, a SHA-256-based `ETag`, and these sandbox headers:

```http
Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Robots-Tag: noindex, nofollow
```

Inline JavaScript and CSS work. SCSS is not browser-native; upload compiled CSS or include a self-contained runtime in the page.

Temporary downloads support `HEAD` and one standard byte range per request:

```bash
curl -I "$FILE_URL"
curl -H "Range: bytes=1000000-" -o partial.bin "$FILE_URL"
```

Valid ranges return `206 Partial Content`; malformed, multiple, or unsatisfiable ranges return `416`. Downloads include `Content-Length`, `Content-Disposition`, `ETag`, and `Accept-Ranges: bytes`. Expired URLs return `404` even if bucket cleanup has not run yet.

## Revoke an upload

HTML pages are permanent by default, and temporary files can be removed before expiry. Deletion is idempotent and removes either object type for the ID:

```bash
curl -fsS -X DELETE "$PUBLIC_BASE_URL/api/uploads/$UPLOAD_ID" \
  -H "Authorization: Bearer $UPLOAD_TOKEN"
```

Success returns `204 No Content`.

## API errors

Errors use JSON with stable `error` and `message` fields.

| Status | Error | Meaning |
| --- | --- | --- |
| `400` | `missing_file`, `invalid_multipart_upload`, `invalid_upload_id` | Invalid client input |
| `401` | `unauthorized` | Missing or invalid bearer token |
| `404` | `not_found` | Unknown API route; missing or expired public reads use a plain 404 response |
| `413` | `payload_too_large`, `html_payload_too_large` | Configured size limit exceeded |
| `415` | `unsupported_media_type` | Request is not valid multipart form data |
| `416` | `range_not_satisfiable` | Download byte range cannot be served |
| `503` | `upload_capacity_reached` | Concurrency gate is full; retry after the `Retry-After` delay |

## Cleanup and deployment

The cleanup worker checks each temporary object's stored `expires-at` value, so changing the current retention setting cannot delete an older object before its promised `expiresAt`. Cleanup runs once at startup and then at the configured interval without overlapping sweeps. A failure inspecting or deleting one object is logged without preventing later objects or pages from being processed.

Railway deploys this service with `services/html-publisher` as the service root. `railway.json` starts the compiled server and uses `/health` as a liveness check. Shutdown stops new requests, gives active requests 10 seconds to drain, and then closes S3 connections.
