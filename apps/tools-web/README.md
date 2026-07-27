# Tools Web

On-demand Bun HTTP service for the public Tools directory and its
Cloudflare Access-protected operations API. It is intentionally request-only:
there are no timers, schedulers, queues, telemetry loops, or startup bucket
requests. The separate `tools-checker` cron owns monitoring work.

## Railway

Deploy from the repository root using `railway.json`, attach the private shared
bucket, and enable **Railway Serverless** for the service so it can sleep between
requests. The deploy health check performs one bucket read.

Required variables:

- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE` (`true` or `false`, optional)
- `CF_ACCESS_ISSUER` (for example `https://team.cloudflareaccess.com`)
- `CF_ACCESS_AUDIENCE`
- `CF_ACCESS_JWKS_URL` (optional; defaults to the issuer's Access cert endpoint)
- `PORT` (provided by Railway; defaults to `3000`)

Cloudflare Access must protect `/ops*` and `/api/ops/*` at the edge. The
application also verifies every Access assertion's signature, issuer, audience,
expiry, and actor itself.

## Storage ownership

The web process may read `catalog/current.json` and the two prepared snapshots.
It can write only `catalog/current.json` (conditionally) and new immutable
`audit/**` records. No API exists here for writing checker state, snapshots, or
history.

See [ROUTES.md](./ROUTES.md) for the UI/backend contract.

## Initial catalog

`config/initial-catalog.json` is a schema-validated, deliberately conservative
seed. It records only the four currently qualifying directory entries. Unknown
stable links are absent, pre-cutover/unresolved public checks are paused, and
the Tailnet-only Network Console is explicitly unavailable from Railway.

Initialize an empty bucket through `PUT /api/ops/catalog` with
`If-None-Match: *` and a valid Cloudflare Access assertion, or upload the file
as `catalog/current.json` using an S3-compatible client with the equivalent
create-only condition. A conflict means a catalog already exists; export and
review it rather than overwriting it. The checker is not a catalog entry.

See `docs/tools-platform/preview-and-cutover.md` for preview isolation,
shadow-checking, D1 revalidation, cutover, and rollback.
