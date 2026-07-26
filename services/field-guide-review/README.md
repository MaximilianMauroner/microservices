# Field guide review

Review-only service for immutable project and global field-guide candidates. Agents submit candidates and sync verdicts; the Shoo-authenticated owner can approve, reject, defer, confirm, or invalidate them without editing or deleting content.

Required variables: `DATABASE_URL`, `AGENT_API_TOKEN`, `SHOO_ALLOWED_EMAIL`, and `PUBLIC_BASE_URL`. `PORT` defaults to `3000`. `src/db/schema.ts` is the canonical database schema.

Use `bun run db:plan` to inspect a proposed direct push and `bun run db:push` to apply it. Both commands are restricted to the `public` schema and exactly `candidates`, `review_rounds`, `verdict_events`, and `application_receipts`; never add `--force`. Railway runs `db:push` as a blocking predeploy step before starting the service, then checks `/health`.

Agent API: `POST /api/agent/candidates`, `GET /api/agent/decisions`, and `POST /api/agent/receipts`. Reviewer API includes `GET /api/review/queue`, paginated `GET /api/review/history?scope=project|global&cursor=...&limit=...`, `POST /api/review/candidates/:id/rounds/:round/verdict`, and append-only `POST /api/review/candidates/:id/rounds/:round/amendments`. There are intentionally no update or delete routes.
