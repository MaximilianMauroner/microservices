# Publisher

## Storage prerequisites

Compose uses `ARTIFACT_S3_ENDPOINT=http://minio:9000`. Signed uploads and file
redirects use that endpoint, which a host browser cannot resolve.

Before P1, P2, P3, P6, or creating P5 fixtures through the browser, require an
owned private storage endpoint reachable by both Tools and the browser. Its
CORS rules must permit signed PUT preflight from the exact selected local Tools
origin, allow the required request headers, and expose `ETag`. Keep these
dependent journeys blocked when those prerequisites are unavailable.

Preserve signed GET/HEAD and range-playback CORS, including reads from
opaque-origin artifact pages and exposed range response headers. See the
[direct-transfer CORS contract](../../../../docs/tools-platform/direct-transfers.md#reviewed-rollout-steps-not-applied).
Record the actual endpoint and CORS checks without credentials. Do not rewrite
a signed URL hostname after signing. This storage setup remains unverified.

For P4, require storage reachability from Tools and the HTTP client when
following signed file redirects. Native HTTP clients do not need browser CORS.
Mark P4 blocked if its required storage endpoint is unreachable.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| P1 | Publish a small HTML artifact and an attachment through the browser. Open its canonical capability URL without a session; verify content and bytes. List it in Library, update it, then delete it and verify access is removed. | publisher/README.md; test/publish-page.test.tsx; publisher tests | Isolated PostgreSQL and private local S3 bucket. Delete artifacts through the UI. |
| P2 | Publish a large video attachment. Open it through the canonical URL, play and seek, and inspect the signed-storage redirect and range response. Verify missing and expired capabilities fail. Preserve expected playback beyond a short URL lifetime. | src/routes/files/$id.ts; src/routes/files/$id/$.ts; test/artifact-request.test.ts; test/range-selection.test.ts | Local S3 must support the signed URL, range, and CORS path. Delete owned video. A mocked response does not prove playback. |
| P3 | In Receive files, create a guest upload link; open it in a clean session, upload a file, and see it in Library. Revoke the link; another upload must fail. Also check configured expiry and limits. | src/routes/publisher/receive.tsx; src/routes/drop/$.ts; test/manage-page.test.tsx; test/direct-upload-client.test.ts | Owned upload link and bucket. Revoke link and delete files. |
| P4 | Upload a multipart file with the local machine bearer token through /api/uploads and retrieve the returned canonical URL. Split another native file into multiple chunks, send them through /api/uploads/chunks, complete the session, and verify the canonical file bytes. Missing and incorrect tokens must fail for each native operation. | publisher/README.md; src/routes/api/uploads.ts; src/routes/api/uploads/$.ts; publisher/test/chunked-upload.test.ts | Local token only. Use README request contracts, record returned IDs, delete artifacts. |
| P5 | In Library, filter by filename, expiry, and project, change each sort, and load older pages. Compare summary counts and results against the owned artifact inventory. Set an exact future expiry, make a file permanent, reload, then revoke it and verify denial. | publisher/README.md; src/routes/publisher/artifacts.tsx; publisher tests | Create enough owned files for two pages and varied expiry/project states. Delete all owned artifacts. |
| P6 | Create enough guest links for two history pages, upload multiple files through one link, inspect history, and download its ZIP. Check names and bytes match the owned uploads. Revoke the link and check later uploads fail. | publisher/README.md; src/routes/publisher/receive.tsx; publisher tests | Owned links, uploads, and browser downloads. Revoke links and delete uploads and local ZIP. |
