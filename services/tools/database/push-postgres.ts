import postgres from "postgres";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import {
  createPushHandoff,
  DISPOSABLE_DATABASE_SENTINEL,
  resolvePushDatabase,
  verifyDisposableDatabase,
  type PushMode,
} from "./postgres-push-guard.js";
import { waitForPostgres } from "./postgres-readiness.js";
import { reconcileRuntimeSchema } from "./runtime-schema-reconciliation.js";

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
  const handoff = createPushHandoff(process.env, mode);
  try {
    const push = spawn("pnpm", ["exec", "drizzle-kit", "push", "--config", config], {
      cwd: new URL(".", import.meta.url),
      env: {
        ...process.env,
        TOOLS_SCHEMA_PUSH_HANDOFF: handoff.path,
        TOOLS_SCHEMA_PUSH_NONCE: handoff.nonce,
        TOOLS_SCHEMA_PUSH_MODE: handoff.mode,
      },
      stdio: "inherit",
    });
    const exitCode = await new Promise<number>((resolve, reject) => {
      push.once("error", reject);
      push.once("exit", (code, signal) => signal ? reject(new Error(`Drizzle schema push terminated by ${signal}.`)) : resolve(code ?? 1));
    });
    if (exitCode !== 0) process.exit(exitCode);
  } finally {
    await rm(handoff.directory, { recursive: true, force: true });
  }
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
