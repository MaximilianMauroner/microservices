# Tools Web

Tools Web is the public directory, truthful status page, and
Cloudflare Access-protected Manage module mounted by `apps/platform-service`.
It is not deployed as a separate Railway service.

## Production runtime

The repository-root `railway.json` starts the unified platform service. That
single process stays awake because it owns the aligned five-minute checker
scheduler. Tools Web and Tools Checker share one private bucket with disjoint
writer ownership enforced in code.

Required platform Access variables:

- `CF_ACCESS_ISSUER`
- `CF_ACCESS_AUDIENCE`, retained as an ordered compatibility fallback
- `CF_ACCESS_MANAGE_AUDIENCE`
- `CF_ACCESS_PUBLISHER_AUDIENCE`
- `CF_ACCESS_REVIEW_AUDIENCE`
- `CF_ACCESS_JWKS_URL`, optional

Configure distinct route-family audiences in production. The application
validates the signature, issuer, family audience, expiry, and actor before
dispatching protected browser routes. Native-token `/api/uploads*` and
`/api/agent*` routes intentionally bypass browser Access and still require
their own bearer credentials.

`GET /live` reports process liveness. `GET /health` checks all shared
dependencies. The component endpoints `/health/tools`, `/health/publisher`,
and `/health/review` report only their named dependency and require no browser
session so the checker can report each component truthfully.

## Storage ownership

The web module may read `catalog/current.json`, prepared snapshots,
`history/**`, and `audit/**`. It can write only `catalog/current.json`
conditionally and immutable `audit/**` protocol records. No API writes checker
state, snapshots, or history.

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
