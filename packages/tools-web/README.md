# Tools Web

Tools Web is the public directory, truthful status page, and authenticated
Manage module mounted by `apps/platform-service`.
It is not deployed as a separate Railway service.

## Production runtime

The repository-root `railway.json` starts the unified platform service. That
single process stays awake because it owns the aligned five-minute checker
scheduler. Tools Web and Tools Checker share one private bucket with disjoint
writer ownership enforced in code.

The private Markdown inventory also requires:

- `MARKDOWN_SHARE_ADMIN_ENDPOINT`, the production Convex HTTP Action URL
- `MARKDOWN_SHARE_ADMIN_TOKEN`, a 32+ character service secret shared with Convex
- `MARKDOWN_SHARE_PUBLIC_ORIGIN`, the Markdown Share browser origin

The platform service authenticates browser requests before dispatching them to
this module and supplies a generic verified principal for attribution.
Native-token `/api/uploads*` and `/api/agent*` routes keep their own bearer
credentials.

`GET /live` reports process liveness. `GET /health` checks all shared
dependencies. The component endpoints `/health/tools`, `/health/publisher`,
and `/health/review` report only their named dependency and require no browser
session so the checker can report each component truthfully.

## Storage ownership

The web module may read `catalog/current.json`, prepared snapshots,
`history/**`, and `audit/**`. It can write only `catalog/current.json`
conditionally and immutable `audit/**` protocol records. The platform gateway
separately owns the single `heartbeats/tower.json` last-seen record. No API
writes checker state, snapshots, or history.

Each mutation creates an immutable audit intent and revision-linked obligation
before the conditional catalog write. It then verifies the canonical outcome
and reverse-time index. Incomplete finalization leaves a durable obligation for
the next mutation or audit read to repair.

## Initial catalog

`config/initial-catalog.json` is a schema-validated conservative seed. It
contains the four qualifying directory entries. The three components mounted
by the unified service monitor their component-specific health endpoints; the
Tailnet-only Network Console remains unavailable from Railway.

Bootstrap `catalog/current.json` with `If-None-Match: *`, then run the unified
checker once to create snapshots. A conflict means a catalog exists and must be
reviewed rather than overwritten. See
`docs/tools-platform/consolidation-cutover.md` for rollout and rollback.

See `ROUTES.md` for the UI/backend contract.

## UI behavior

The public status page reports **Observed uptime** only over recorded checks;
the 90-cell calendar marks days without data separately and names the earliest
observed day. Its aggregate gives outages and checking states precedence, then
reports healthy measured services separately from services not measured.
Below the public services it links to `/manage/status`, which uses the Manage
Access audience and renders only active services excluded from the public
projection. The response requires the shared browser session, is non-cacheable, and does not render
operator notes, notification delivery details, or monitor target URLs.
Directory destinations on the current browser origin use a chevron and open
in the current tab. Cross-origin destinations use an external arrow, open in a
new tab with `rel=noreferrer`, and announce that behavior to assistive
technology.

Manage uses a searchable/filterable record list and one focused editor. Links
are edited as validated structured rows with an optional synchronized JSON
view. History and audit requests have an eight-second timeout and explicit
accessible retry; mutations are never retried automatically. Structural no-op
mutations return the current revision without catalog or audit writes.
`/manage/documents` is a read-only Markdown Share inventory. It uses the same
browser session and fetches active document metadata through a bearer-
protected Convex HTTP Action, and never retrieves document bodies.
