# Tools Web route contract

All JSON responses have `Content-Type: application/json`, an `X-Request-Id`,
`X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

## Public

| Method | Path | Response |
|---|---|---|
| `GET` | `/` | Server-rendered public directory from `PublicSnapshotDocument` only. |
| `GET` | `/api/public/catalog` | Decoded `PublicSnapshotDocument`; cacheable for 60 seconds. |
| `GET` | `/health` | `{"ok":true}` after a real bucket read; `503` if storage cannot be read. |
| `GET` | `/assets/tools.css`, `/assets/ops.js` | Fixed CSP-compatible assets; no arbitrary file paths. |

Public routes read only `snapshots/public.json`. They never project from the
private catalog in the request process.

## Protected

Every `/ops`, `/ops/*`, and `/api/ops/*` request requires a valid
`Cf-Access-Jwt-Assertion`. Authentication failures return
`401 {"error":"access_required"}`.

| Method | Path | Response / operation |
|---|---|---|
| `GET` | `/ops`, `/ops/*` | Server-rendered operations UI from the latest catalog plus prepared private checker state. |
| `GET` | `/api/ops/catalog` | Full `CatalogDocument` plus an `ETag` containing its revision. |
| `GET` | `/api/ops/snapshot` | Decoded `PrivateSnapshotDocument`. |
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

Except initialization and reads, mutations require `If-Match: "<revision>"`.
Successful writes return `{ "revision": "...", "reload": true }` and the new
revision `ETag`. A stale revision returns
`409 {"error":"revision_conflict","revision":"...","message":"..."}`; if an
S3 race prevents the follow-up revision read, `revision` may be absent. The UI
does not retry and offers explicit reload/dismiss actions. Every successful
admin write appends one
audit object containing only actor, timestamp, action, target type/ID, and
before/after catalog revisions.

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
