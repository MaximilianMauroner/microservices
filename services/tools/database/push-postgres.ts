import postgres from "postgres";
import {
  DISPOSABLE_DATABASE_SENTINEL,
  resolvePushDatabase,
  verifyDisposableDatabase,
  type PushMode,
} from "./postgres-push-guard.js";
import { waitForPostgres } from "./postgres-readiness.js";
import { reconcileRuntimeSchema } from "./runtime-schema-reconciliation.js";
import { runSchemaPush } from "./run-schema-push.js";

const mode = process.argv[2];
if (mode !== "production" && mode !== "development" && mode !== "test") throw new Error("Schema push mode must be production, development, or test.");
const url = resolvePushDatabase(process.env, mode satisfies PushMode);

if (mode === "production") {
  await waitForPostgres(() => checkPostgres(url), undefined, undefined, ({ attempt, delayMs }) => {
    console.warn(JSON.stringify({ event: "postgres.readiness.retry", attempt, delayMs }));
  });
}
if (mode === "test") {
  const database = postgres(url, { max: 1 });
  try {
    await verifyDisposableDatabase({
      readRelationKind: async () => (await database<{ kind: string }[]>`
        select c.relkind::text kind from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
      readValue: async () => (await database<{ value: string }[]>`
        select sentinel_value value from tools_runtime_test_sentinel
        where sentinel_key=${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
    });
  } finally {
    await database.end();
  }
}

for (const config of ["drizzle.tools.config.ts", "drizzle.artifacts.config.ts"] as const) {
  await runSchemaPush(config, process.env, mode);
}

const database = postgres(url, { max: 1 });
try {
  await reconcileRuntimeSchema(database);
} finally {
  await database.end();
}

async function checkPostgres(databaseUrl: string) {
  const database = postgres(databaseUrl, { max: 1, connect_timeout: 2, idle_timeout: 1 });
  try {
    await database`select 1`;
  } finally {
    await database.end({ timeout: 1 });
  }
}
