# Platform Service

The platform service is the single production compute and authentication
boundary for the hosted tools platform. It mounts the existing modules without
moving their data:

| Route | Module |
| --- | --- |
| `/`, `/status`, `/manage/status`, `/manage`, `/api/ops/*` | Tools catalog, public/private status, management, and private Markdown inventory |
| `/publish`, `/artifacts/*`, `/files/*` | Artifact publisher browser and public capability-read routes |
| `/review`, `/api/review/*` | Field-guide review browser routes |
| `/api/uploads*`, `/api/agent*`, `/api/heartbeat/tower` | Native-token machine APIs |
| in-process, every five minutes | Tools checker |

The redacted Tools and status routes (`/`, `/status`, `/assets/tools.css`, and
`/api/public/catalog`) are public. The exact `/assets/ops.js` browser dependency
is also public so an authenticated Manage page can load its client behavior;
the script contains no privileged data and is not a trust boundary. Private
status at `/manage/status`, Manage HTML, data under `/api/ops/*`, and all
mutations remain Access-protected. Artifact/file
`GET`/`HEAD` delivery is public and unlisted: the unguessable URL is the read
capability, and the backing bucket remains private. Publish, Review, Manage,
upload/list/revoke surfaces, and non-read delivery requests require a valid
`Cf-Access-Jwt-Assertion`. Legacy `/p/*` and `/f/*` capability reads redirect
with `308` before Access verification; protected `/uploads` and `/ops/*`
redirects occur only after verification.

`/manage/documents` uses the existing Manage Access application and renders a
read-only Markdown Share inventory. The platform calls a bearer-protected
Convex HTTP Action server-to-server and does not request Markdown bodies.

`/api/uploads*`, `/api/agent*`, and `/api/heartbeat/tower` intentionally bypass
browser Access so automation does not need a browser assertion. They remain
protected by their native bearer authenticators. Tower sends a heartbeat every
minute using `TOWER_HEARTBEAT_TOKEN`; `/health/tower` returns healthy while the
latest durable heartbeat is no more than three minutes old. The token must be
at least 32 non-whitespace characters. `TOWER_HEARTBEAT_STALE_AFTER_MS` can
override the three-minute threshold.

`/live`, `/health`, `/health/tools`, `/health/publisher`, `/health/review`, and
`/health/tower` are public and assertion-free. Railway uses aggregate `/health`;
the in-process checker uses the component and Tower routes so one dependency
cannot borrow another component's result. The Tower route reveals only whether
the heartbeat is current, never its credential or timestamp.

The service requires one distinct audience tag in each of
`CF_ACCESS_MANAGE_AUDIENCE`, `CF_ACCESS_PUBLISHER_AUDIENCE`, and
`CF_ACCESS_REVIEW_AUDIENCE`. Missing, multiple, or overlapping tags fail
startup regardless of `NODE_ENV`.

The service preserves the two S3 buckets and existing field-guide PostgreSQL
database. Their variables are namespaced as `TOOLS_S3_*`, `ARTIFACT_S3_*`, and
`FIELD_GUIDE_DATABASE_URL` so credentials cannot be confused.

The HTTP composition root is TanStack Start on Nitro's Bun preset. File-based
route handlers live in `src/routes`, and `src/start.ts` applies the central
Access policy before any route delegate runs. The production build writes the
Nitro bundle to `.output/`; the process must start from this package directory
so the mounted Field Guide stylesheet resolves from the sibling app.

## Commands

```bash
bun run build
bun run typecheck
bun run test
bun run start
```
