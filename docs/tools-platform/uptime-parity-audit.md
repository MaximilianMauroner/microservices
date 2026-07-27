# Legacy uptime behavior parity audit

This audit was completed before removing `services/uptime-monitor`.

| Required behavior | Replacement evidence |
| --- | --- |
| HTTP(S)-only URLs, no credentials, normalized hosts | `packages/tools-domain/src/url.ts` and schema decoders |
| Block private, loopback, link-local, reserved, documentation, multicast, and embedded IPv4 literals | `packages/tools-domain/src/ip.ts`; its coverage is a formatted superset of the legacy implementation |
| Validate initial targets and redirects | `validatedMonitorUrl`, `validatedRedirectUrl`, and checker probe tests |
| GET probe, manual redirects, at most one redirect, bounded total timeout, 2xx–3xx success | `jobs/tools-checker/src/probe.ts` and `test/probe.test.ts` |
| Open incident after the second consecutive failure; resolve on success | `packages/tools-domain/src/transitions.ts` and checker run tests |
| Durable down/recovery outbox with retry and `Retry-After`/capped backoff | checker state schema, `jobs/tools-checker/src/notifications.ts`, and notification tests |
| Idempotent scheduled work | deterministic five-minute run IDs and duplicate-run tests |
| Bounded concurrency | `CHECK_CONCURRENCY` validation and checker concurrent map |
| Thirty-day raw check retention while retaining incidents | checker history pruning and retention tests |
| Tailscale-only target semantics | no fetch; `unavailable_from_railway` observation/status |
| Protected administration | Cloudflare Access edge policy plus independent JWT verification in Tools Web |
| Sanitized operational logging | checker/web structured loggers omit secrets, request bodies, headers, webhook URLs, and exception text |

The following legacy product features are intentionally not migrated as
required monitoring behavior: D1-specific schedule-slot capacity, manual
“check now,” Discord test endpoint, rate-limit tables, cursor-based chart
buckets, and retroactive out-of-order D1 observation folding. The replacement
uses one curated catalog, deterministic cron slots, prepared snapshots, daily
history partitions, and optimistic object-store concurrency.

Source removal does not delete the deployed Cloudflare Worker, its route,
Access application, or D1 database. External retirement and rollback follow
`preview-and-cutover.md`.
