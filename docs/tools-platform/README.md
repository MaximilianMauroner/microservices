# Tools operations

Tools is one TanStack Start monolith deployed as a single Railway service. Its
products live directly under `services/tools`: Dashboard, Status, Publisher,
Field Guide, Money, and Feedback. They share authentication, configuration, lifecycle,
health checks, and deployment.

The process also owns leased scheduled work for Status. It must remain awake,
but multiple replicas are safe because PostgreSQL arbitrates each schedule
slot. Dashboard and monitor definitions are typed code. PostgreSQL stores
runtime state; object storage holds artifact bodies and derived status
snapshots.

- [runtime-boundaries.md](./runtime-boundaries.md): service and product ownership.
- [access-incident.md](./access-incident.md): authentication containment and recovery.
- [bucket-recovery.md](./bucket-recovery.md): PostgreSQL and object-storage recovery.

## Operational checks

- `/live` proves that the process is running.
- `/health` proves that required dependencies are ready.
- Public pages and canonical artifact URLs do not require a browser session.
- Private browser routes use one Better Auth Google session.
- Upload, agent, and heartbeat APIs retain dedicated bearer credentials.

Deployments run `pnpm run railway:predeploy` before starting Tools. That command
applies the Tools and Field Guide migrations and reconciles artifact metadata.
Never point a local or preview process at production data.
