# Publisher

## Storage prerequisites

The owned local stack maps MinIO to loopback and gives the host-run Tools
process that loopback endpoint. Its storage check sends a signed PUT preflight,
uploads a part, checks the exposed `ETag`, and confirms MinIO retained it.
Require this check before P1, P2, P3, P6, or creating P5 fixtures through the
browser. The browser must also reach the signed storage URL.

Preserve signed GET/HEAD and range-playback CORS, including reads from
opaque-origin artifact pages and exposed range response headers. See the
[Publisher storage contract](../../../../services/tools/products/publisher/README.md)
and [direct-transfer contract](../../../../services/tools/products/publisher/direct-transfers.md).
Record the actual endpoint and CORS checks without credentials. Do not rewrite
a signed URL hostname after signing. The verification-stack HTTP check does not
replace browser acceptance.

For P4, require storage reachability from Tools and the HTTP client when
following signed file redirects. Native HTTP clients do not need browser CORS.
Mark P4 blocked if its required storage endpoint is unreachable.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| P1 | Publish a small HTML artifact and an attachment through the browser. Open its canonical capability URL without a session; verify content and bytes. List it in Library, update it, then **Revoke** it and verify access is removed. | services/tools/products/publisher/README.md; services/tools/app/routes/publisher/index.tsx; services/tools/products/publisher/ui/publish-page.tsx; services/tools/test/products/publisher/publish-page.test.tsx | Isolated PostgreSQL and owned MinIO. Revoke artifacts through the UI. |
| P2 | Publish a large video attachment. Open it through the canonical URL, play and seek, and inspect the signed-storage redirect and range response. Verify missing and expired capabilities fail. Preserve expected playback beyond a short URL lifetime. | services/tools/app/routes/files/$id.ts; services/tools/app/routes/files/$id/$.ts; services/tools/products/publisher/file-response.ts; services/tools/test/platform/artifact-request.test.ts; services/tools/test/platform/ui/range-selection.test.ts | Owned MinIO must support the signed URL, range, and CORS path. Revoke the owned video. A mocked response does not prove playback. |
| P3 | In Receive files, create a guest upload link; open it in a clean session, upload a file, and see it in Library. Revoke the link; another upload must fail. Check configured expiry and limits. | services/tools/app/routes/publisher/receive.tsx; services/tools/app/routes/drop/$.ts; services/tools/products/publisher/ui/upload-link-manager.tsx; services/tools/test/products/publisher/manage-page.test.tsx; services/tools/test/products/publisher/direct-upload-client.test.ts | Owned upload link and MinIO bucket. Revoke the link and delete files. |
| P4 | Upload a multipart file with the local machine bearer token through /api/uploads and retrieve the returned canonical URL. Split another native file into chunks, send them through /api/uploads/chunks, complete the session, and verify the canonical file bytes. Missing and incorrect tokens must fail for each native operation. | services/tools/products/publisher/README.md; services/tools/app/routes/api/uploads.ts; services/tools/app/routes/api/uploads/$.ts; services/tools/test/products/publisher/chunked-upload.test.ts | Local token only. Use the README request contracts, record returned IDs, and revoke artifacts. |
| P5 | In Library, filter by filename, kind, expiry, project, and category. Test each sort, including Largest first, and load older pages. Compare counts with the owned inventory. Set a future expiry, make a file permanent, reload, then revoke it and verify denial. | services/tools/products/publisher/README.md; services/tools/app/routes/publisher/artifacts.tsx; services/tools/products/publisher/ui/manage-page.tsx; services/tools/test/products/publisher/manage-page.test.tsx | Create enough owned files for two pages and varied expiry, project, category, and kind states. Revoke all owned artifacts. |
| P6 | Create enough guest links for two history pages, upload multiple files through one link, inspect history, and download its ZIP. Check names and bytes match the owned uploads. Revoke the link and check later uploads fail. | services/tools/products/publisher/README.md; services/tools/products/publisher/ui/upload-link-manager.tsx; services/tools/test/products/publisher | Owned links, uploads, and browser downloads. Revoke links and delete uploads and the local ZIP. |
| P7 | Open Family QR. Replace the image and confirm the share link stays the same. Reload and confirm the new image remains. | services/tools/app/routes/publisher/qr.tsx; services/tools/products/publisher/ui/family-qr-page.tsx | Use an owned image and verify the existing share URL before and after replacement. Restore the original image if available. |
