# Tools Web UI integration contract

The UI is server-rendered and framework-free. `renderPublicPage(snapshot)` accepts only a decoded `PublicSnapshotDocument`. `renderOperationsPage({ snapshot, actor, revision })` accepts a decoded private snapshot and the independently verified Cloudflare Access actor. The server must send HTML with a restrictive CSP and serve `/assets/tools.css` plus `/assets/ops.js` from `public/assets`.

The public page makes no requests. Its JSON counterpart is `GET /api/public/catalog`.

Operations routes are same-origin JSON endpoints protected by Cloudflare Access and application-level JWT verification:

- `POST /api/ops/groups`; `PATCH|DELETE /api/ops/groups/:id`
- `POST /api/ops/groups/:id/reorder` with `{ "direction": "up" | "down" }`
- `POST /api/ops/entries`; `PATCH|DELETE /api/ops/entries/:id`
- `POST /api/ops/entries/:id/reorder` with `{ "direction": "up" | "down" }`
- `POST /api/ops/entries/:id/archive|restore`
- `POST /api/ops/entries/:id/monitor/pause|resume`
- `PUT /api/ops/order` remains available for complete programmatic ordering;
  the browser uses the directional routes above.

Every mutation receives `Content-Type: application/json`, `Accept: application/json`, and `If-Match: "<revision>"`. Successful responses return `{ "revision": "...", "reload": true }`; the current UI reloads after success so server projections remain authoritative. A stale write returns HTTP 409 with `{ "error": "revision_conflict", "revision": "...", "message": "..." }`. The `revision` field can be absent only when the S3 race is followed by a failed catalog read. The UI never retries a conflict and offers explicit reload or dismiss actions. Validation failures use 400 and `{ "error": "invalid_request", "message": "..." }`.

HTML form names are dotted for nested monitor fields. The client converts unchecked checkboxes to `false` and parses the `links` field as JSON before sending. Delete requires typing the exact displayed record name into a modal before a `DELETE` request is sent.

All values are escaped by renderers and destination links are limited again to HTTP(S). Keep executable JavaScript external; do not add inline handlers, background polling, analytics, or telemetry because the Railway service must be able to sleep.
