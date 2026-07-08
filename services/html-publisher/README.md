# Railway Temporary File Upload Microservice

Uploads HTML pages and temporary files into a private Railway Storage Bucket and serves each file through an unguessable public URL. HTML pages are still served in the browser for plan publishing. All other file types are served as downloads and expire after 3 days by default.

## Required Environment

- `UPLOAD_TOKEN`: bearer token required by `POST /api/uploads`
- `S3_BUCKET`: Railway bucket API name
- `S3_ENDPOINT`: S3-compatible endpoint, usually `https://storage.railway.app`
- `S3_REGION`: bucket region
- `S3_ACCESS_KEY_ID`: bucket access key
- `S3_SECRET_ACCESS_KEY`: bucket secret key
- `PUBLIC_BASE_URL`: optional public base URL used in upload responses
- `MAX_UPLOAD_BYTES`: optional max upload size, default `5000000000`
- `TEMPORARY_FILE_RETENTION_MS`: optional temporary file retention window, default `259200000` (3 days)
- `TEMPORARY_FILE_CLEANUP_INTERVAL_MS`: optional cleanup interval, default `3600000` (1 hour)
- `S3_FORCE_PATH_STYLE`: optional, set to `true` only if the bucket requires path-style URLs

## Railway Deployment

This service continues to deploy to Railway from `services/html-publisher`. The sibling Tailscale port dashboard is a VM-local systemd service and should not be deployed to Railway.

## HTML Upload

```bash
curl -X POST "$PUBLIC_BASE_URL/api/uploads" \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -F "file=@page.html;type=text/html"
```

Successful response:

```json
{
  "id": "unguessable-token",
  "url": "https://service.up.railway.app/p/unguessable-token",
  "bytes": 1234,
  "sha256": "..."
}
```

Anyone with the returned URL can view the uploaded HTML.

## Temporary File Upload

```bash
curl -X POST "$PUBLIC_BASE_URL/api/uploads" \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -F "file=@archive.zip;type=application/zip"
```

Successful response:

```json
{
  "id": "unguessable-token",
  "url": "https://service.up.railway.app/f/unguessable-token/archive.zip",
  "bytes": 12345678,
  "expiresAt": "2026-07-10T12:00:00.000Z",
  "sha256": "..."
}
```

Anyone with the returned URL can download the file until it expires. The service deletes expired temporary file objects from the bucket during startup cleanup and then on the configured cleanup interval.

The app-level default upload cap is 5 GB because the service stores files with a single S3-compatible `PutObject` request. Larger objects require multipart S3 upload support. Railway has indicated that request duration is still bounded by its HTTP timeout, so very slow 5 GB uploads may fail before the app limit is reached.

## Public HTML Runtime

Uploaded pages are served with a sandboxed CSP that allows inline JavaScript, forms, modals, popups, and downloads while keeping pages on an opaque sandboxed origin:

```http
Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads
```

Inline CSS works normally. SCSS is not a browser-native stylesheet language, so upload compiled CSS or include your own client-side compiler/runtime in the HTML.
