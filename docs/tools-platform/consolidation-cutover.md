# Unified platform cutover

The cutover moves compute and authentication without moving data. The catalog
bucket, artifact bucket, and field-guide PostgreSQL database remain in place.

## Required Cloudflare state

1. The Tools home at `tools.mauroner.net/`, Status at `/status`, the public
   stylesheet, fixed `/assets/ops.js`, and `/api/public/catalog` remain public.
   They expose only the redacted catalog, current monitor state, and observed
   check aggregates; no-data days are not counted as monitoring history.
2. Self-hosted Access applications group protected routes that share a browser
   session: Manage (`/manage`, `/manage/*`, legacy `/ops*`, `/api/ops/*`),
   Publisher (`/publish`, `/publish/*`, legacy `/uploads*`,
   `/api/external-uploads`), and Field Guide
   (`/review`, `/review/*`, `/review.css`, `/review-suite.css`,
   `/api/review/*`). These are the same three families enforced by the origin.
   Do not place `GET`/`HEAD` delivery at `/artifacts/*`, `/files/*`, legacy
   `/p/*`, or legacy `/f/*` behind Access: each unguessable URL is an unlisted
   read capability. The artifact bucket itself remains private.
3. The human Allow policy includes only the intended operator identity. Opening
   `/manage` from the public Tools page therefore starts the Cloudflare Access
   identity-provider flow before the request reaches Railway.
4. Railway validates the `Cf-Access-Jwt-Assertion` signature, issuer, and the
   route-family audience again at the origin. Set
   `CF_ACCESS_MANAGE_AUDIENCE`, `CF_ACCESS_PUBLISHER_AUDIENCE`, and
   `CF_ACCESS_REVIEW_AUDIENCE` to one distinct tag each. Production startup
   rejects missing, multiple, or overlapping family tags.
5. `/api/uploads*` and `/api/agent*` are machine APIs. Do not put them behind
   browser Access; they retain their native upload and agent bearer tokens.
6. The checker probes `/health/tools`, `/health/publisher`, and
   `/health/review`. Each endpoint checks only its named dependency.

## Order of operations

1. Configure the Access applications without changing DNS.
2. Deploy `platform-service` to the existing `tools-web` Railway service.
3. Verify `/health` on the Railway domain. Confirm `/`, `/status`, and known
   `/artifacts/*` and `/files/*` capabilities load without a session;
   `/publish`, `/review`, and `/manage` start the Cloudflare Access flow.
   Confirm missing, revoked, and expired capabilities return `404`.
4. Confirm public `GET`/`HEAD` redirects from `/p/*` and `/f/*`, plus protected
   redirects from `/uploads` and `/ops/*`, preserve IDs, encoded filenames,
   subpaths, and queries. Confirm API and mutation methods are not redirected
   and remain protected.
5. Update the live catalog to the canonical `tools.mauroner.net` URLs and wait
   for a successful checker pass against all three component health endpoints.
6. Stop the old checker cron, field-guide app, and publisher app. Keep all
   legacy services deployable and keep the field-guide PostgreSQL service and
   both buckets throughout the rollback window.
7. Observe the legacy aliases for at least one complete production release.
   Retirement requires recorded access evidence and explicit operator approval;
   do not remove aliases in the same release as cutover.

Cloudflare Access application edits, live catalog replacement, DNS changes,
and retirement of old services are external rollout actions. Repository tests
and local redirects do not substitute for those production steps.

## Rollback

1. Restore the previous `tools-web` deployment and its former `/` Status page,
   checker cron, catalog URLs, and Cloudflare origin.
2. Restart the old publisher and field-guide services and restore their route
   applications.
3. Remove the suite navigation adapters and unified route mappings so the old
   services do not link back into the failed deployment.
4. Verify the old `/` Status response, one checker slot, native upload and agent
   APIs, and authenticated browser flows before declaring rollback complete.
5. Keep Access applications, databases, buckets, aliases, and old deployable
   artifacts until rollback approval is closed.
