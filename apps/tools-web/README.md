# Tools Web

On-demand Bun HTTP service for the public Tools directory and its
Cloudflare Access-protected operations API. It is intentionally request-only:
there are no timers, schedulers, queues, telemetry loops, or startup bucket
requests. The separate `tools-checker` cron owns monitoring work.

## Railway

Set the Railway service **source root to `apps/tools-web`**. Railway then reads
this directory's `railway.json` and starts it with exactly `bun run start`.
Attach the private shared bucket and enable **Railway Serverless** so the
service can sleep between requests.

`GET /live` is process liveness only. The Railway deploy check uses
`GET /health`, which decodes `catalog/current.json`,
`snapshots/public.json`, and `snapshots/private.json`. Bootstrap the catalog
directly into the bucket with a create-only write, run Tools Checker once to
create both snapshots, and only then deploy Tools Web. Missing or corrupt
required objects intentionally keep the deployment unready.

Required variables:

- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE` (`true` or `false`, optional)
- `CF_ACCESS_ISSUER` (for example `https://team.cloudflareaccess.com`)
- `CF_ACCESS_AUDIENCE`
- `CF_ACCESS_JWKS_URL` (optional; defaults to the issuer's Access cert endpoint)
- `PUBLIC_ORIGIN` (exact public HTTPS origin, such as
  `https://tools.mauroner.net`; used for mutation CSRF checks)
- `PORT` (provided by Railway; defaults to `3000`)

Cloudflare Access must protect `/ops*` and `/api/ops/*` at the edge. The
application also verifies every Access assertion's signature, issuer, audience,
expiry, and actor itself.

## Storage ownership

The web process may read `catalog/current.json`, prepared snapshots,
`history/**`, and `audit/**`. It can write only `catalog/current.json`
(conditionally) and immutable `audit/**` protocol records. No API exists here
for writing checker state, snapshots, or history.

Each mutation first creates an immutable audit intent and a revision-linked
obligation, conditionally writes the catalog, then verifies both the canonical
audit outcome and its reverse-time index record. A writer must finalize the
obligation for the exact revision it read before advancing that revision.
Incomplete finalization fails the request while leaving the durable obligation
for the next mutation or audit read to repair. Failed catalog writes create
immutable cancellation markers only after a conclusive conditional-write
failure. Canonical outcomes retain their established keys; a durable migration
marker records completion of legacy reverse-time indexing.

See [ROUTES.md](./ROUTES.md) for the UI/backend contract.

## Initial catalog

`config/initial-catalog.json` is a schema-validated, deliberately conservative
seed. It records only the four currently qualifying directory entries. Unknown
stable links are absent, pre-cutover/unresolved public checks are paused, and
the Tailnet-only Network Console is explicitly unavailable from Railway.

Before the first Tools Web deployment, upload the seed as
`catalog/current.json` using an S3-compatible client with
`If-None-Match: *`, then run Tools Checker once. After the service is ready,
the protected `PUT /api/ops/catalog` route is also available for empty
non-Railway test instances. A conflict means a catalog already exists; export
and review it rather than overwriting it. The checker is not a catalog entry.

See `docs/tools-platform/preview-and-cutover.md` for preview isolation,
shadow-checking, D1 revalidation, cutover, and rollback.
