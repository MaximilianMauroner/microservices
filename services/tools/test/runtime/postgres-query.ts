import postgres from "postgres";
import { waitForPostgres } from "../../database/postgres-readiness.ts";
import { DISPOSABLE_DATABASE_SENTINEL, verifyDisposableDatabase } from "../../database/postgres-push-guard.ts";
import { requireLoopbackPostgres } from "./postgres.ts";

async function run() {
  const operation = process.argv[2];
  if (!["ready", "initialize", "verify"].includes(operation ?? "")) throw new Error("Invalid PostgreSQL query operation.");
  const url = requireLoopbackPostgres(process.env.TOOLS_RUNTIME_POSTGRES_URL ?? "");
  const database = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    if (operation === "ready") {
      await waitForPostgres(async () => { await database`select 1`; });
    } else if (operation === "initialize") {
      await database`create table public.tools_runtime_test_sentinel (sentinel_key text primary key, sentinel_value text not null)`;
      await database`insert into public.tools_runtime_test_sentinel values (${DISPOSABLE_DATABASE_SENTINEL.key}, ${DISPOSABLE_DATABASE_SENTINEL.value})`;
    } else {
      await verifyDisposableDatabase({
        readRelationKind: async () => (await database<{ kind: string }[]>`
          select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
        readValue: async () => (await database<{ value: string }[]>`
          select sentinel_value value from public.tools_runtime_test_sentinel
          where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
      });
    }
  } finally {
    await database.end({ timeout: 1 });
  }
  process.stdout.write(`${operation}\n`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const safeMessages = [
    "Disposable database sentinel must be an existing regular table.",
    "Disposable database sentinel value is missing or invalid.",
  ];
  process.stderr.write(`${safeMessages.includes(message) ? message : "PostgreSQL fixture query failed."}\n`);
  process.exitCode = 1;
}
