# Field Guide

Field Guide is a product inside the Tools monolith. It reviews project and
global field-guide candidates and task-scoped agent decision records. Submitted
content is immutable. Feedback and verdict amendments are append-only.

The browser UI is mounted at `/field-guide` by `services/tools`. Internal
`/api/review*` routes use the shared Better Auth session. Native-token
`/api/agent*` routes require `AGENT_API_TOKEN`.

## Runtime configuration

- `DATABASE_URL` points to PostgreSQL.
- `AGENT_API_TOKEN` authenticates agent API calls.
- `PUBLIC_BASE_URL` is the canonical Tools origin.
- `DECISION_RECORD_ARCHIVE_DAYS` defaults to `90`.

PostgreSQL is the only supported database. Field Guide has no standalone
runtime and no SQLite compatibility backend.

## Database schema

The Drizzle schema is defined in `src/db/postgres-schema.ts`. Schema pushes are
explicit and fail closed:

```sh
FIELD_GUIDE_SCHEMA_PUSH_CONFIRM=field-guide-console-production \
  pnpm run db:push-postgres
```

Disposable integration tests require both `TEST_DATABASE_URL` and
`FIELD_GUIDE_TEST_DATABASE_CONFIRM=field-guide-console-test`. The test database
must contain this sentinel before a test may apply the schema:

```sql
CREATE TABLE public.field_guide_review_test_sentinel (
  sentinel_key text PRIMARY KEY,
  sentinel_value text NOT NULL
);

INSERT INTO public.field_guide_review_test_sentinel (sentinel_key, sentinel_value)
VALUES ('database-purpose', 'field-guide-console-disposable-test-database');
```

Integration tests can modify the configured test database. Never point them at
production.

## Development

```sh
pnpm run build
pnpm run typecheck
pnpm run test
```
