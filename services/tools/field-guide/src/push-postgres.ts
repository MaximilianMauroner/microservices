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

const handoff = createPushHandoff(process.env, mode);
const push = spawn("pnpm", ["exec", "drizzle-kit", "push", "--config", "drizzle.postgres.config.ts"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    FIELD_GUIDE_SCHEMA_PUSH_HANDOFF: handoff.path,
    FIELD_GUIDE_SCHEMA_PUSH_NONCE: handoff.nonce,
    FIELD_GUIDE_SCHEMA_PUSH_MODE: handoff.mode,
  },
  stdio: "inherit",
});
const exitCode = await new Promise<number>((resolve, reject) => {
  push.once("error", reject);
  push.once("exit", (code, signal) => {
    if (signal) reject(new Error(`Drizzle schema push terminated by ${signal}.`));
    else resolve(code ?? 1);
  });
});
await rm(handoff.directory, { recursive: true, force: true });
process.exit(exitCode);
