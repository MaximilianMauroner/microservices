# Field Guide Console

The Field Guide Console reviews project and global field-guide candidates and
task-scoped agent decision records. Submitted content is immutable. Decision
feedback and candidate verdict amendments are append-only.

Production is mounted by `apps/platform-service` at `/review` and uses the
Field Guide Cloudflare Access audience. `/api/review*` shares that browser
boundary. Native-token `/api/agent*` intentionally bypasses browser Access and
requires `AGENT_API_TOKEN`.

The standalone process is retained for repository and agent-API development.
It does not implement a compatible browser identity flow: `/`, `/review*`, and
`/api/review*` return a clear `503`. Use the unified platform for browser work.

## Runtime configuration

The unified production service uses:

- `FIELD_GUIDE_DATABASE_URL`
- `AGENT_API_TOKEN`
- `PUBLIC_ORIGIN`

The focused standalone process accepts `DATABASE_BACKEND=postgres` with
`DATABASE_URL`, or `DATABASE_BACKEND=sqlite` with an absolute `SQLITE_PATH`.
It also requires `AGENT_API_TOKEN` and `PUBLIC_BASE_URL`. `PORT` defaults to
`3000`. `DECISION_RECORD_ARCHIVE_DAYS` controls when reviewed records leave the
active inbox and defaults to `90`; unresolved records are retained indefinitely.

Railway runs `bun run --cwd packages/field-guide-console db:push-postgres` in its
pre-deploy phase. The pre-deploy command maps the service-specific
`FIELD_GUIDE_DATABASE_URL` to `DATABASE_URL` only for the Drizzle schema push
and supplies the required production confirmation marker. The platform
readiness check touches both the existing review queue and the decision-record
schema before a deployment is accepted. PostgreSQL is the production database
used by the unified service. SQLite support remains for focused development,
import, and recovery work; it is not a separate production browser deployment.

## APIs

Agent routes:

- `POST /api/agent/candidates`
- `POST /api/agent/decision-records`
- `GET /api/agent/decisions`
- `POST /api/agent/receipts`

Decision review routes:

- `GET /api/review/decision-records`
- `GET /api/review/decision-records/:id`
- `POST /api/review/decision-records/:id/feedback`
- `POST /api/review/decision-records/promotions`

The inbox defaults to unresolved records grouped by task. Feedback actions are
`up`, `down`, and `dismiss`; comments are optional and amendments preserve the
prior event. Promotion accepts reviewed source records and creates a normal,
inactive field-guide candidate. It never activates or edits a lesson directly.

Candidate reviewer routes continue to provide queue, paginated history,
verdict, append-only amendment, and pre-approval scope reassignment. Candidate
content and submitted decision records have no update or delete routes.

## Development

SQLite schema changes are applied directly from `src/db/schema.ts` with
`bun run db:push-sqlite`. The command requires an explicit absolute
`SQLITE_PATH` and
`FIELD_GUIDE_SQLITE_PUSH_CONFIRM=field-guide-console-sqlite`; startup never
changes the schema. Production PostgreSQL schema changes are applied from
`src/db/postgres-schema.ts` with `bun run db:push-postgres`. A production push
requires `DATABASE_URL` and
`FIELD_GUIDE_SCHEMA_PUSH_CONFIRM=field-guide-console-production`.
Disposable test workflows use `bun run db:push-postgres:test`; that command
requires the test confirmation and verifies the sentinel before Drizzle starts.
The Drizzle config rejects direct invocation so both paths remain fail closed.

PostgreSQL integration and round-trip tests must use a disposable database that
is dedicated to Field Guide Console tests. Configure both:

- `TEST_DATABASE_URL`
- `FIELD_GUIDE_TEST_DATABASE_CONFIRM=field-guide-console-test`

The test database must also contain this sentinel before the tests run:

```sql
CREATE TABLE public.field_guide_review_test_sentinel (
  sentinel_key text PRIMARY KEY,
  sentinel_value text NOT NULL
);

INSERT INTO public.field_guide_review_test_sentinel (sentinel_key, sentinel_value)
VALUES ('database-purpose', 'field-guide-console-disposable-test-database');
```

These tests verify the confirmation marker, table type, and sentinel value
before applying the schema. They can modify data in the configured database;
never point them at production.

For recovery into PostgreSQL, set `RECOVERY_DATABASE_URL` and
`FIELD_GUIDE_RECOVERY_CONFIRM=field-guide-console-recovery`, then run
`bun run db:recover-postgres`. Recovery verifies logical hashes and sequences
before completing.
