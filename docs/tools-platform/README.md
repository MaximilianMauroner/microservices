# Tools operations

Tools is one TanStack Start monolith deployed as a single Railway service. Its
products live directly under `services/tools`: Dashboard, Status, Publisher,
Field Guide, Money, Feedback, and the Markdown Share frontend. They share authentication, configuration, lifecycle,
health checks, and deployment.

Status work runs in a dedicated bounded Railway cron process. The main Tools
service can sleep between real traffic and the cron's 30-minute probes.
PostgreSQL arbitrates repeated schedule slots. Dashboard and monitor definitions
are typed code. PostgreSQL stores runtime state; object storage holds artifact
bodies and derived status snapshots.

Markdown Share keeps its canonical state, realtime editing, presence, checkpoints,
retention, and cleanup in Convex. Tools serves its public capability-link frontend.

The web process closes idle PostgreSQL connections after two minutes. Keep that
timeout below Railway's ten-minute inactivity window. Hourly artifact cleanup
and daily market-data work may wake the service, but neither should keep it
awake between runs.

- [runtime-boundaries.md](./runtime-boundaries.md): service and product ownership.
- [access-incident.md](./access-incident.md): authentication containment and recovery.
- [bucket-recovery.md](./bucket-recovery.md): PostgreSQL and object-storage recovery.

## Operational checks

- `/live` proves that the process is running.
- `/health` proves that required dependencies are ready.
- Public pages and canonical artifact URLs do not require a browser session.
- Markdown Share creation and capability document pages do not require a browser session.
- Private browser routes use one Better Auth Google session.
- Upload, agent, and heartbeat APIs retain dedicated bearer credentials.

Deployments run `pnpm run railway:predeploy` before starting Tools. That command
applies the Tools and Field Guide migrations and reconciles artifact metadata.
Never point a local or preview process at production data.
