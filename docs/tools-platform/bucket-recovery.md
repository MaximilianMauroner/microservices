# Data export and recovery

## Ownership map

| Data | Authority | Recovery source |
| --- | --- | --- |
| Product and monitor definitions | Typed repository code | Reviewed Git commit |
| Status runs, observations, incidents, heartbeats, and leases | PostgreSQL `tools` schema | PostgreSQL backup |
| Field Guide data | PostgreSQL `field_guide` schema | PostgreSQL backup |
| Artifact metadata and operation journal | PostgreSQL `artifacts` schema | PostgreSQL backup |
| Artifact file bodies | Private object-storage bucket | Bucket export |
| Public/private status snapshots | Object storage, derived | Regenerate from code and PostgreSQL |

PostgreSQL and the artifact bucket must be backed up together. Artifact IDs and
object keys are stable, so preserve them exactly. Status snapshots are output
projections and must never be used as the recovery authority.

## Recovery

1. Stop Tools to prevent browser writes and scheduled work during restoration.
2. Export the damaged database and bucket before changing either one.
3. Restore PostgreSQL first, preserving the `tools`, `field_guide`, and
   `artifacts` schemas.
4. Restore artifact bodies with their original object keys. Do not invent
   replacement IDs or legacy URL aliases.
5. Run `pnpm run railway:predeploy` against the restored database. Migrations
   are idempotent and artifact-operation reconciliation repairs interrupted
   uploads after their leases expire.
6. Start one Tools replica and verify `/live`, `/health`, canonical artifact
   reads, Field Guide access, and one Status pass.
7. Restore normal replica count and traffic only after those checks pass.

Treat database URLs, bucket credentials, OAuth secrets, and bearer tokens as
secrets. Never store them in repository files, shell history, logs, artifacts,
or incident tickets.
