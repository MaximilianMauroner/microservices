# Tools Web route contract

All JSON responses have `Content-Type: application/json`, an `X-Request-Id`,
`X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

## Public

| Method | Path | Response |
|---|---|---|
| `GET`, `HEAD` | `/` | Server-rendered public Tools directory from `PublicSnapshotDocument` only. |
| `GET`, `HEAD` | `/status` | Current state and exactly 90 rolling UTC days of recorded check history; unknown days remain unknown. |
| `GET` | `/api/public/catalog` | Decoded `PublicSnapshotDocument`; cacheable for 60 seconds. |
| `GET` | `/live` | Process liveness; no bucket access. |
| `GET` | `/health` | Readiness; decodes the required catalog plus public and private snapshots, otherwise `503`. |
| `GET` | `/assets/tools.css` | Public fixed CSP-compatible stylesheet. |
| `GET`, `HEAD` | `/assets/ops.js` | Public fixed management script; it contains no credentials and all Manage data and mutations remain protected. |

Public routes read only `snapshots/public.json`. They never project from the
private catalog in the request process.

## Protected

Every `/manage`, `/manage/*`, and `/api/ops/*` request requires the generic
authenticated principal supplied by the platform gateway. Authentication
failures return `401 {"error":"authentication_required"}`.

| Method | Path | Response / operation |
|---|---|---|
| `GET`, `HEAD` | `/manage/status` | Server-rendered current status for active services excluded from the public projection; private fields such as operator notes and notification errors are not rendered. |
| `GET`, `HEAD` | `/manage/documents` | Read-only active Markdown Share inventory fetched server-side from the bearer-protected Convex admin endpoint. |
| `GET` | `/manage`, `/manage/*` | Server-rendered management UI from the latest catalog plus prepared private checker state. |
| `GET` | `/api/ops/catalog` | Full `CatalogDocument` plus an `ETag` containing its revision. |
| `GET` | `/api/ops/snapshot` | Decoded `PrivateSnapshotDocument`. |
| `GET` | `/api/ops/audit?limit=&cursor=` | `{ "items": AdminAuditRecord[], "nextCursor": string \| null }`; newest-first canonical immutable records with opaque lossless cursors, and the read repairs durable pending audit intents. |
| `GET` | `/api/ops/history?limit=&cursor=` | `{ "items": HistoryPartitionDocument[], "nextCursor": string \| null }`; newest-first daily partitions; new observations identify their monitor and migrated legacy observations use `null`. |
| `GET` | `/api/ops/incidents?limit=&cursor=` | `{ "items": Incident[], "nextCursor": string \| null }`; incidents newest-first from the prepared private snapshot. |
| `PUT` | `/api/ops/catalog` | Initialize from a complete `CatalogDocument`; requires `If-None-Match: *`. |
| `POST` | `/api/ops/groups` | Create a complete `CatalogGroup`. |
| `PATCH` | `/api/ops/groups/:id` | Update UI-editable group fields. |
| `PUT` | `/api/ops/groups/:id` | Replace a complete group; IDs cannot change. |
| `DELETE` | `/api/ops/groups/:id` | Delete an empty group. |
| `POST` | `/api/ops/groups/:id/reorder` | Move with `{ "direction": "up" | "down" }`. |
| `POST` | `/api/ops/entries` | Create a complete `CatalogEntry`. |
| `PATCH` | `/api/ops/entries/:id` | Update UI-editable entry/monitor fields. |
| `PUT` | `/api/ops/entries/:id` | Replace a complete entry; IDs cannot change. |
| `DELETE` | `/api/ops/entries/:id` | Delete an entry. |
| `POST` | `/api/ops/entries/:id/archive` | Set lifecycle to `archived`. |
| `POST` | `/api/ops/entries/:id/restore` | Set lifecycle to `active`. |
| `POST` | `/api/ops/entries/:id/reorder` | Move within its group. |
| `POST` | `/api/ops/entries/:id/monitor/pause` | Pause the entry monitor. |
| `POST` | `/api/ops/entries/:id/monitor/resume` | Resume the entry monitor. |
| `PUT` | `/api/ops/order` | Reorder all groups and entries. |

Every mutation requires an `Origin` exactly equal to configured
`PUBLIC_ORIGIN` and an `application/json` content type; principal verification
still happens first. Cross-origin/missing-origin requests return
`403`; non-JSON requests return `400`. Except initialization and reads,
mutations also require `If-Match: "<revision>"`.
Successful changed writes return `{ "revision": "...", "reload": true, "changed": true }` and the new
revision `ETag` only after its canonical audit outcome and audit index are
verified. If catalog storage commits but audit finalization remains incomplete,
the request fails and a durable revision-linked obligation blocks a subsequent
writer from advancing until repair succeeds. A stale revision returns
`409 {"error":"revision_conflict","revision":"...","message":"..."}`; if an
S3 race prevents the follow-up revision read, `revision` may be absent. The UI
does not retry and offers explicit reload/dismiss actions. Every successful
admin write appends one
audit object containing only actor, timestamp, action, target type/ID, and
before/after catalog revisions.
Structurally unchanged mutations return the existing revision with
`{ "reload": false, "changed": false }` and create neither a catalog revision
nor an audit record.

The reorder body is:

```json
{
  "groupIds": ["public-tools", "operations"],
  "entryIdsByGroup": {
    "public-tools": ["artifact-publisher"],
    "operations": []
  }
}
```

Request bodies are limited to 256 KB. Validation failures are `400`; missing
objects are `404`; unexpected failures are sanitized `500` responses.
