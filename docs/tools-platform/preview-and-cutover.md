# Superseded preview and cutover runbook

This document described the former split deployment with a sleeping Tools Web
service and a separate Railway checker cron. That architecture is retired.

Use `consolidation-cutover.md` for the current rollout. The production shape is
one always-awake `platform-service` process with an aligned in-process
five-minute checker. Do not create a separate Tools Web service, enable
scale-to-zero, or schedule a separate checker cron.

For preview validation, deploy the repository-root service against isolated
buckets and an isolated field-guide database. Use separate Cloudflare Access
applications and route-family audiences. Keep notifications disabled, run the
in-process checker, and verify:

- public `/`, `/status`, and `/api/public/catalog`;
- component-specific health endpoints;
- cross-family Access assertion rejection;
- native-token access to `/api/uploads*` and `/api/agent*`;
- canonical and legacy browser routes, including `GET` and `HEAD`;
- redaction of private catalog, Access, and notification data.

Production cutover, legacy alias observation, explicit retirement approval,
and rollback steps are maintained only in `consolidation-cutover.md`.
