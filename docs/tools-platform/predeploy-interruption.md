# Failed schema push after a database interruption

The schema push runs each Drizzle configuration once. A failed child command
stops the deployment before the next schema, runtime reconciliation, or Publisher
backfill. The guarded handoff directory is removed on success and failure.

Do not automatically retry a schema push or backfill after a lost connection.
Drizzle CLI progress output is not a structured guarantee that no mutation began.
An interrupted statement can have an unknown outcome. Keep the original child
logs and the configuration named in the failure. Before an authorized retry,
an operator must establish the failed stage and inspect any possible partial
changes through a separately authorized database procedure.

## Incident evidence: 2026-10-05

- Tools deployment `f1cec7af-61ee-41ee-a356-dfa939b0c92d`, commit
  `4aa01547c4a3e397a0d5f3028345d3330c846894`, passed build and image push.
  Its predeploy failed during Tools schema introspection with `read ECONNRESET`
  at 20:55:52 UTC. The commit changed verification documentation only.
- PostgreSQL logs show `Stopping Container` at 20:55:54 UTC and
  `Starting Container` at 20:59:03 UTC. Startup removed a stale `postmaster.pid`
  and reported an unclean shutdown and automatic recovery. PostgreSQL reported
  readiness at 20:59:03.377 UTC.
- A read-only Railway check on 2026-10-06 found Tools online with one running
  replica at deployment `5101a21a-390c-4a73-81d8-857548a2fe19`, commit
  `9601243b63ce92bf77f47ea00942e9ecb5cd1c1d`. The failed deployment is not live.
- Railway's 13-hour aggregate metrics, sampled every 60 seconds, reported
  PostgreSQL memory at most 0.0992 GB and a maximum limit of 8 GB. These samples
  do not establish a termination cause or exclude an unsampled event.
- Available logs do not identify why PostgreSQL stopped. Railway's deeper
  incident investigation tool returned `Agent usage limit reached`. Container
  termination reason, audit events, and timestamped platform metrics remain
  unavailable in this investigation. No OOM or operator action is established.

## Remaining operational action

Max must obtain the PostgreSQL termination reason from Railway platform events
or support for project `87d88446-cd98-4a45-8097-99d46e7826fe`, environment
`b0bb7096-88c8-4798-b1b8-92e3c9bddcfa`, service
`dc66dd26-39bc-4843-a6c5-f929cbf36a2a`, around 20:55:52 UTC.
Then authorize any required operational correction and a deployment retry after
the failed stage and possible partial changes are verified. Merging this repair
also needs Max's decision: main automatically deploys and predeploy writes
schema and data. This repair improves failure handling; it does not recover the
failed production deployment or prevent a platform shutdown.

No production database query, write, configuration change, restart, or deployment
was performed for this investigation.
