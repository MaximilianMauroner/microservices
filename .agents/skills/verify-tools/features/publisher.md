# Publisher

Drive the real user paths and verify the saved result.

## Sub-features

- P1. Publish a small HTML artifact and an attachment through the browser. Open its canonical capability URL without a session; verify content and bytes. List it in Library, update it, then delete it and verify access is removed.
- P2. Publish a large video attachment. Open it through the canonical URL, play and seek, and inspect the signed-storage redirect and range response. Verify missing and expired capabilities fail. Preserve expected playback beyond a short URL lifetime.
- P3. In Receive files, create a guest upload link; open it in a clean session, upload a file, and see it in Library. Revoke the link; another upload must fail. Also check configured expiry and limits.
- P4. Use Fleet's source CLI to create HTML, replace the same artifact, and upload a temporary file through direct sessions. Verify stable identity, recovery, stored hashes, and storage PUTs. Missing and incorrect bearer tokens must fail for native control operations.
- P5. In Library, filter by filename, expiry, and project, change each sort, and load older pages. Compare summary counts and results against the owned artifact inventory. Set an exact future expiry, make a file permanent, reload, then revoke it and verify denial.
- P6. Create enough guest links for two history pages, upload multiple files through one link, inspect history, and download its ZIP. Check names and bytes match the owned uploads. Revoke the link and check later uploads fail.
- P7. Open a PDF at its canonical URL in a browser. Download it with the explicit Download control and compare bytes.

## How to get to it (user POV)

Open `/publisher` on the owned Tools origin. Publisher also has the native Fleet
upload CLI and canonical `/artifacts/` and `/files/` links.

## Driving it with T3 preview and the native CLI

Preconditions:

- The Tools doctor passes for this run's state directory.
- Private pages require an authorized local OAuth client and subject.
- Use the actions, expected results, and additional prerequisites below.

## Storage prerequisites

The helper sets `ARTIFACT_S3_ENDPOINT` to `http://127.0.0.1:49000` by
default. `--storage-port` changes that port. Tools, the native client, and the
browser must reach that same endpoint. If the browser runs on another host,
loopback points to that host. Keep dependent journeys blocked until the browser
can reach the owned endpoint. Do not rewrite signed URL hostnames.

The helper installs bucket CORS for signed PUTs from the exact Tools origin,
exposes `ETag`, and permits GET and HEAD from opaque artifact origins.
Before browser uploads or playback, check real preflight, signed reads, ranges,
and exposed response headers. A successful CORS setup command alone does not
prove browser access. See the
[direct-transfer CORS contract](../../../../docs/tools-platform/direct-transfers.md#reviewed-rollout-steps-not-applied).
Record the endpoint and results without credentials or signed URLs.
Native HTTP clients need storage reachability but do not need browser CORS.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| P1 | Publish a small HTML artifact and an attachment through the browser. Open its canonical capability URL without a session; verify content and bytes. List it in Library, update it, then delete it and verify access is removed. | publisher/README.md; test/publish-page.test.tsx; publisher tests | Isolated PostgreSQL and private local S3 bucket. Delete artifacts through the UI. |
| P2 | Publish a large video attachment. Open it through the canonical URL, play and seek, and inspect the signed-storage redirect and range response. Verify missing and expired capabilities fail. Preserve expected playback beyond a short URL lifetime. | src/routes/files/$id.ts; src/routes/files/$id/$.ts; test/artifact-request.test.ts; test/range-selection.test.ts | Local S3 must support the signed URL, range, and CORS path. Delete owned video. A mocked response does not prove playback. |
| P3 | In Receive files, create a guest upload link; open it in a clean session, upload a file, and see it in Library. Revoke the link; another upload must fail. Also check configured expiry and limits. | src/routes/publisher/receive.tsx; src/routes/drop/$.ts; test/manage-page.test.tsx; test/direct-upload-client.test.ts | Owned upload link and bucket. Revoke link and delete files. |
| P4 | Use Fleet's source CLI to create HTML, replace the same artifact, and upload a temporary file through direct sessions. Verify stable identity, recovery, stored hashes, and storage PUTs. Missing and incorrect bearer tokens must fail for native control operations. | publisher/scripts/upload-direct.ts; publisher/test/direct-uploads.integration.test.ts; Fleet skills/file-upload/scripts/upload.py | Local token only. Use the direct CLI procedure below. Preserve source files and prior stored bodies. |
| P5 | In Library, filter by filename, expiry, and project, change each sort, and load older pages. Compare summary counts and results against the owned artifact inventory. Set an exact future expiry, make a file permanent, reload, then revoke it and verify denial. | publisher/README.md; src/routes/publisher/artifacts.tsx; publisher tests | Create enough owned files for two pages and varied expiry/project states. Delete all owned artifacts. |
| P6 | Create enough guest links for two history pages, upload multiple files through one link, inspect history, and download its ZIP. Check names and bytes match the owned uploads. Revoke the link and check later uploads fail. | publisher/README.md; src/routes/publisher/receive.tsx; publisher tests | Owned links, uploads, and browser downloads. Revoke links and delete uploads and local ZIP. |
| P7 | Open a PDF inline, then use Library's Download control. Verify canonical `?download=1` returns the same PDF as an attachment. | src/routes/files/$id/$.ts; src/routes/publisher/artifacts.tsx; publisher/test/direct-uploads.integration.test.ts | Browser PDF viewer and authorized local OAuth for Library. Preserve the PDF fixture and downloaded bytes. |

## P4 direct CLI procedure

Set `FLEET_UPLOAD_PY` to `skills/file-upload/scripts/upload.py` in the isolated
Fleet source checkout. Use absolute paths for owned source files. Run each
command through `native-fixtures.py run --state "$TOOLS_VERIFY_STATE" --`.
Do not use the installed upload skill or its credentials.

1. Run `python3 "$FLEET_UPLOAD_PY" "$HTML_SOURCE" --project direct-check`.
   Save its printed request UUID and canonical result in private evidence.
   Inspect the stored ID, URL, project, creation time, object key, size, and hash.
2. Keep the original source and stored body. Use a separate revised HTML file.
   Run `python3 "$FLEET_UPLOAD_PY" "$REVISED_HTML_SOURCE" --replace-id "$ARTIFACT_ID"`.
   Require the same ID, URL, project, and creation time. Require the revised raw
   stored hash and bytes. Verify the prior body still exists unchanged.
3. Upload an owned temporary file through the same CLI. Also run
   `pnpm --dir services/tools/publisher upload:direct "$FILE_SOURCE"` and repeat
   with an HTML source. This TypeScript helper covers create, not replacement.
4. Observe native app requests and signed storage PUTs with an owned loopback
   observer. Require `/api/uploads/sessions` control requests and file bodies
   sent to storage. Require no multipart or chunk body forwarding through Tools.
   Tools can read storage to verify bytes. Redact bearer headers and signed URLs.
5. Drop initialization and completion responses, then repeat the same operation
   with `--request-id "$REQUEST_ID"`. Repeat after restarting the owned Tools
   process. Require the same completed result without a new artifact or body.
   Keep source bytes and replacement target unchanged for each recovery attempt.
6. Check source mutation rejection with a separate disposable copy. Confirm
   source files survive success and failure. Check missing and incorrect bearer
   tokens on initialize, status, part signing, complete, and abort operations.
   Native bearer auth must not authorize browser session routes.

Record each command, request UUID, raw-byte comparison, and result privately.
Protected HTML delivery adds a favicon, so its delivered hash can differ from
the stored body. A skipped suite or mocked request does not prove P4.
Legacy multipart and chunk compatibility checks are separate from direct CLI
acceptance. Do not remove their routes based on a direct CLI pass.

## Browser replacement and PDF checks

For P1, use Library's Replace action with a revised HTML source. Verify the same
canonical ID and URL, the revised page, retained prior raw bytes, and unchanged
project when omitted. Keep this browser check blocked without authorized local
OAuth. A native replacement does not prove the browser action.

For P7, use both a PDF classified as `application/pdf` and a retained fixture
classified as binary with a `.pdf` filename. Open each canonical `/files/` URL
in the browser. Require inline PDF content where the browser supports it.
Inspect the signed storage response for PDF MIME and inline disposition.
Check canonical HEAD and byte-range reads. Use Library's Download action and
open the canonical `?download=1` URL. Require attachment disposition and bytes
that match the original PDF. Also check the native result's `downloadUrl`.
Keep Library checks blocked without local OAuth. If the preview cannot show a
PDF or save a download, retain the HTTP evidence and mark that browser step
blocked. HTTP headers alone do not prove PDF viewing or the Download control.

## Gotchas

Unavailable prerequisites mean blocked. A different entry point does not prove
an unrun path. Keep captures after cleanup. Use no production endpoint.
