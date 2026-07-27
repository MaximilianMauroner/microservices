# Unified platform cutover

The cutover moves compute and authentication without moving data. The catalog
bucket, artifact bucket, and field-guide PostgreSQL database remain in place.

## Required Cloudflare state

1. The Tools home at `tools.mauroner.net/`, Status at `/status`, the public
   stylesheet, and `/api/public/catalog` remain public. They expose only the
   redacted catalog, current monitor state, and aggregated 90-day check counts.
2. Self-hosted Access applications group routes that share a browser session:
   Manage (`/manage`, `/manage/*`, legacy `/ops*`, `/api/ops/*`), Publisher
   (`/publish`, `/publish/*`, legacy `/uploads*`, `/api/uploads*`,
   `/api/external-uploads`), Artifact Content (`/artifacts/*`, `/files/*`,
   legacy `/p/*`, legacy `/f/*`), and Field Guide (`/review`, `/review/*`,
   `/review.css`, `/review-suite.css`, `/api/review/*`, `/api/agent/*`).
   This split stays within Cloudflare's five-destination limit while keeping
   each UI with its APIs.
3. The human Allow policy includes only the intended operator identity. Opening
   `/manage` from the public Tools page therefore starts the Cloudflare Access
   identity-provider flow before the request reaches Railway.
4. Railway validates the `Cf-Access-Jwt-Assertion` signature, issuer, and one
   of the comma-separated `CF_ACCESS_AUDIENCE` tags again at the origin.
   Protected routes fail closed when the assertion is absent or invalid.
5. The checker probes the public `/health` endpoint, which verifies all shared
   storage and database dependencies without requiring a service token.

## Order of operations

1. Configure the Access applications without changing DNS.
2. Deploy `platform-service` to the existing `tools-web` Railway service.
3. Verify `/health` on the Railway domain. Confirm `/` and `/status` load
   without a session; `/publish`, `/artifacts/*`, `/files/*`, `/review`, and
   `/manage` start the Cloudflare Access flow; direct-origin requests without
   a valid assertion fail closed.
4. Confirm authenticated `GET`/`HEAD` redirects from `/uploads`, `/p/*`,
   `/f/*`, and `/ops/*` preserve IDs, encoded filenames, subpaths, and queries.
   Confirm API and mutation methods are not redirected.
5. Update the live catalog to the canonical `tools.mauroner.net` URLs and wait
   for a successful
   checker pass against `/health`.
6. Stop the old checker cron, field-guide app, and publisher app. Keep the
   field-guide PostgreSQL service and both buckets.

Cloudflare Access application edits, live catalog replacement, DNS changes,
and retirement of old services are external rollout actions. Repository tests
and local redirects do not substitute for those production steps.

## Rollback

Restore the previous `tools-web` deployment, leave the old publisher and
field-guide services running, and restore their catalog URLs. Do not remove the
Access application, databases, buckets, or old services until the unified
service has completed at least one authenticated checker interval.
