# Platform Service

The platform service is the single production compute and authentication
boundary for the hosted tools platform. It mounts the existing modules without
moving their data:

| Route | Module |
| --- | --- |
| `/`, `/status`, `/manage`, `/api/ops/*` | Tools catalog, status, and management |
| `/publish`, `/artifacts/*`, `/files/*` | Artifact publisher browser and public capability-read routes |
| `/review`, `/api/review/*` | Field-guide review browser routes |
| `/api/uploads*`, `/api/agent*` | Native-token machine APIs |
| in-process, every five minutes | Tools checker |

The redacted Tools and status routes (`/`, `/status`, `/assets/tools.css`, and
`/api/public/catalog`) are public. The exact `/assets/ops.js` browser dependency
is also public so an authenticated Manage page can load its client behavior;
the script contains no privileged data and is not a trust boundary. Manage HTML,
data under `/api/ops/*`, and all mutations remain Access-protected. Artifact/file
`GET`/`HEAD` delivery is public and unlisted: the unguessable URL is the read
capability, and the backing bucket remains private. Publish, Review, Manage,
upload/list/revoke surfaces, and non-read delivery requests require a valid
`Cf-Access-Jwt-Assertion`. Legacy `/p/*` and `/f/*` capability reads redirect
with `308` before Access verification; protected `/uploads` and `/ops/*`
redirects occur only after verification.

`/api/uploads*` and `/api/agent*` intentionally bypass browser Access so
automation does not need a browser assertion. They remain protected by their
native upload and agent bearer authenticators.

`/live`, `/health`, `/health/tools`, `/health/publisher`, and `/health/review`
are public and assertion-free. Railway uses aggregate `/health`; the in-process
checker uses the component routes so one dependency cannot borrow another
component's result.

The service requires one distinct audience tag in each of
`CF_ACCESS_MANAGE_AUDIENCE`, `CF_ACCESS_PUBLISHER_AUDIENCE`, and
`CF_ACCESS_REVIEW_AUDIENCE`. Missing, multiple, or overlapping tags fail
startup regardless of `NODE_ENV`.

The service preserves the two S3 buckets and existing field-guide PostgreSQL
database. Their variables are namespaced as `TOOLS_S3_*`, `ARTIFACT_S3_*`, and
`FIELD_GUIDE_DATABASE_URL` so credentials cannot be confused.

## Commands

```bash
bun run typecheck
bun run test
bun run start
```
