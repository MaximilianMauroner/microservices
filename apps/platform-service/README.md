# Platform Service

The platform service is the single production compute and authentication
boundary for the hosted tools platform. It mounts the existing modules without
moving their data:

| Route | Module |
| --- | --- |
| `/`, `/status`, `/manage`, `/api/ops/*` | Tools catalog, status, and management |
| `/publish`, `/api/uploads/*`, `/artifacts/*`, `/files/*` | Artifact publisher |
| `/review`, `/api/review/*`, `/api/agent/*` | Field-guide review |
| in-process, every five minutes | Tools checker |

The redacted Tools and status routes (`/`, `/status`, `/assets/tools.css`, and
`/api/public/catalog`) are public. Publish, artifact/file delivery, Review, and
Manage require a valid `Cf-Access-Jwt-Assertion`. Legacy browser `GET`/`HEAD`
routes (`/uploads`, `/p/*`, `/f/*`, and `/ops/*`) redirect with `308` only
after Access verification; API and mutation routes are unchanged. `/health`
and `/live` remain assertion-free for Railway health checks. Agent and upload
bearer tokens remain inner authorization and do not bypass Access.

The service preserves the two S3 buckets and existing field-guide PostgreSQL
database. Their variables are namespaced as `TOOLS_S3_*`, `ARTIFACT_S3_*`, and
`FIELD_GUIDE_DATABASE_URL` so credentials cannot be confused.

## Commands

```bash
bun run typecheck
bun run test
bun run start
```
