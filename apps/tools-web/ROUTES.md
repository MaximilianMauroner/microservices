# Tools Web route contract

All JSON responses have `Content-Type: application/json`, an `X-Request-Id`,
`X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

## Public

| Method | Path | Response |
|---|---|---|
| `GET` | `/` | Calls `PageRenderer.public(publicSnapshot)`. The default fallback emits the snapshot as JSON. |
| `GET` | `/api/public/catalog` | Decoded `PublicSnapshotDocument`; cacheable for 60 seconds. |
| `GET` | `/health` | `{"ok":true}` after a real bucket read; `503` if storage cannot be read. |

Public routes read only `snapshots/public.json`. They never project from the
private catalog in the request process.

## Protected

Every `/ops`, `/ops/*`, and `/api/ops/*` request requires a valid
`Cf-Access-Jwt-Assertion`. Authentication failures return
`401 {"error":"access_required"}`.

| Method | Path | Response / operation |
|---|---|---|
| `GET` | `/ops` | Calls `PageRenderer.ops(catalog, actor)`. |
| `GET` | `/api/ops/catalog` | Full `CatalogDocument` plus an `ETag` containing its revision. |
| `GET` | `/api/ops/snapshot` | Decoded `PrivateSnapshotDocument`. |
| `PUT` | `/api/ops/catalog` | Initialize from a complete `CatalogDocument`; requires `If-None-Match: *`. |
| `POST` | `/api/ops/groups` | Create a complete `CatalogGroup`. |
| `PUT` | `/api/ops/groups/:id` | Replace a group; IDs cannot change. |
| `DELETE` | `/api/ops/groups/:id` | Delete an empty group. |
| `POST` | `/api/ops/entries` | Create a complete `CatalogEntry`. |
| `PUT` | `/api/ops/entries/:id` | Replace an entry; IDs cannot change. |
| `DELETE` | `/api/ops/entries/:id` | Delete an entry. |
| `POST` | `/api/ops/entries/:id/archive` | Set lifecycle to `archived`. |
| `POST` | `/api/ops/entries/:id/pause` | Pause the entry monitor. |
| `POST` | `/api/ops/entries/:id/resume` | Resume the entry monitor. |
| `PUT` | `/api/ops/order` | Reorder all groups and entries. |

Except initialization and reads, mutations require `If-Match: "<revision>"`.
Successful writes return the complete updated catalog and its new revision
`ETag`. A stale revision or an S3 conditional-write race returns
`409 {"error":"catalog_conflict"}`. Every successful admin write appends one
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
