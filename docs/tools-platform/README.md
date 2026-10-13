# Tools operations

Tools is one TanStack Start monolith deployed as a single Railway service. Its
products live directly under `services/tools`: Dashboard, Status, Publisher,
Money, Feedback, and the Markdown Share frontend. They share authentication, configuration, lifecycle,
health checks, and deployment.

Status work runs in a dedicated bounded Railway cron process. The main Tools
service can sleep between real traffic and the cron's 30-minute probes.
PostgreSQL arbitrates repeated schedule slots. Dashboard and monitor definitions
are typed code. PostgreSQL stores runtime state; object storage holds artifact
bodies and derived status snapshots.

Markdown Share keeps its canonical state, realtime editing, presence, checkpoints,
retention, and cleanup in Convex. Tools serves its public capability-link frontend.

The web process closes idle PostgreSQL connections after two minutes. Liveness
requests avoid runtime allocation; application requests initialize the runtime,
and session requests initialize auth. The status page refreshes only when visible.
The checker keeps its 30-minute route and heartbeat detection cadence.

Artifact cleanup and daily market-data synchronization run through
`pnpm --dir services/tools run maintenance`. This bounded process has no HTTP
listener and exits after current due work. `railway.maintenance.json` is an
unapplied hourly cron proposal at minute 15. PostgreSQL schedule slots prevent
repeated completed work; expired leases recover interruption, and known failed
slots can retry. Missed slots coalesce to current cleanup and provider backfill.
The process deadline plus shutdown grace is shorter than the lease.

Deploying a new maintenance service needs Max's approval. Keep the web scheduler
active until the new job has terminal-success evidence, then deploy this web
change and confirm no web maintenance activity. Rollback starts by restoring the
previous web revision and stopping the proposed maintenance schedule; preserve
completed schedule rows and all data. These changes do not prove a monthly saving.
After direct transfers, measure effective web and database sleep and metered duty
before accepting this cost bundle. Railway applies sleep settings only when a
container is created, so settings readback alone is not acceptance.

- [runtime-boundaries.md](./runtime-boundaries.md): service and product ownership.
- [access-incident.md](./access-incident.md): authentication containment and recovery.
- [direct-transfers.md](./direct-transfers.md): durable direct uploads, signed downloads, and reviewed rollout.
- [bucket-recovery.md](./bucket-recovery.md): PostgreSQL and object-storage recovery.
- [predeploy-interruption.md](./predeploy-interruption.md): failed schema push handling and the October 5 database interruption.

## Operational checks

- `/live` proves that the process is running.
- `/health` proves that required dependencies are ready.
- Public pages and canonical artifact URLs do not require a browser session.
- Expiring `/drop/:token` capabilities accept guest uploads until revoked or expired;
  their management routes require the browser session.
- Document Share creation (`/share`) and capability document pages do not require a browser session. Existing `/markdown` links remain public aliases.
- Private browser routes use one Better Auth Google session.
- Upload, agent, and heartbeat APIs retain dedicated bearer credentials.

Deployments run `pnpm run railway:predeploy` before starting Tools. That command
applies the Tools database schemas and reconciles artifact metadata.
Never point a local or preview process at production data.
