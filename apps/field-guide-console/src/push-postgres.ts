import postgres from "postgres";
import {
  DISPOSABLE_DATABASE_SENTINEL,
  PUSH_AUTHORIZATION,
  resolvePushDatabase,
  verifyDisposableDatabase,
  type PushMode,
} from "./postgres-push-guard.js";

const mode = process.argv[2];
if (mode !== "production" && mode !== "test") {
  throw new Error("Schema push mode must be either production or test.");
}

const url = resolvePushDatabase(process.env, mode satisfies PushMode);
if (mode === "test") {
  const database = postgres(url, { max: 1 });
  try {
    await verifyDisposableDatabase({
      readRelationKind: async () => (await database<{ kind: string }[]>`
        SELECT c.relkind::text kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
      readValue: async () => (await database<{ value: string }[]>`
        SELECT sentinel_value value FROM field_guide_review_test_sentinel
        WHERE sentinel_key=${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
    });
  } finally {
    await database.end();
  }
}

const push = Bun.spawn(["bun", "x", "drizzle-kit", "push", "--config", "drizzle.postgres.config.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    FIELD_GUIDE_SCHEMA_PUSH_URL: url,
    FIELD_GUIDE_SCHEMA_PUSH_AUTHORIZATION: PUSH_AUTHORIZATION,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await push.exited);
