import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { DISPOSABLE_DATABASE_SENTINEL, verifyDisposableDatabase } from "../../database/postgres-push-guard.ts";

const execute = promisify(execFile);
const dockerHost = "unix:///var/run/docker.sock";

export function rejectInheritedDataEndpoints(environment: NodeJS.ProcessEnv) {
  const names = Object.keys(environment).filter((name) => environment[name]?.trim() && (
    /(^|_)(DATABASE_URL|POSTGRES_URL|S3_ENDPOINT|S3_BUCKET)$/.test(name)
    || ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "DOCKER_HOST", "DOCKER_CONTEXT"].includes(name)
  ));
  if (environment.NODE_ENV === "production" || environment.TOOLS_ENVIRONMENT === "production") {
    throw new Error("BLOCKED production-environment. Verification requires a local test environment.");
  }
  if (names.length) throw new Error(`BLOCKED inherited-data-endpoints. Unset ${names.sort().join(", ")} before verification.`);
}

export function requireLoopbackPostgres(url: string) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    || !parsed.port || parsed.pathname.length < 2 || parsed.search || parsed.hash) {
    throw new Error("BLOCKED postgres-fixture. A loopback PostgreSQL URL with an explicit port and database is required.");
  }
  return url;
}

async function verifyFixtureSentinel(database: ReturnType<typeof postgres>) {
  await verifyDisposableDatabase({
    readRelationKind: async () => (await database<{ kind: string }[]>`
      select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
    readValue: async () => (await database<{ value: string }[]>`
      select sentinel_value value from public.tools_runtime_test_sentinel
      where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
  });
}

async function docker(args: string[], environment: NodeJS.ProcessEnv = process.env) {
  return execute("docker", ["--host", dockerHost, ...args], { env: environment, timeout: 120_000, maxBuffer: 1024 * 1024 });
}

export async function createOwnedPostgres(environment: NodeJS.ProcessEnv) {
  rejectInheritedDataEndpoints(environment);
  try {
    await docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    throw new Error("BLOCKED postgres-fixture. Docker must be installed and its local daemon must be available.");
  }
  const name = `tools-runtime-${randomUUID()}`;
  const password = randomBytes(32).toString("hex");
  let database: ReturnType<typeof postgres> | undefined;
  try {
    await docker([
      "run", "--detach", "--name", name, "--label", `tools.runtime.fixture=${name}`,
      "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw",
      "--env", "POSTGRES_USER=tools_runtime", "--env", "POSTGRES_DB=tools_runtime",
      "--env", "POSTGRES_PASSWORD", "postgres:16-alpine",
    ], { ...environment, POSTGRES_PASSWORD: password });
    const deadline = Date.now() + 60_000;
    while (true) {
      try {
        await docker(["exec", name, "pg_isready", "--username=tools_runtime", "--dbname=tools_runtime"]);
        break;
      } catch {
        if (Date.now() >= deadline) throw new Error("PostgreSQL did not become ready.");
        await setTimeout(500);
      }
    }
    const { stdout } = await docker(["port", name, "5432/tcp"]);
    const port = /^127\.0\.0\.1:(\d+)\s*$/.exec(stdout)?.[1];
    if (!port) throw new Error("Docker did not publish an owned loopback PostgreSQL port.");
    const url = requireLoopbackPostgres(`postgres://tools_runtime:${password}@127.0.0.1:${port}/tools_runtime`);
    database = postgres(url, { max: 1, connect_timeout: 5 });
    await database`create table public.tools_runtime_test_sentinel (sentinel_key text primary key, sentinel_value text not null)`;
    await database`insert into public.tools_runtime_test_sentinel values (${DISPOSABLE_DATABASE_SENTINEL.key}, ${DISPOSABLE_DATABASE_SENTINEL.value})`;
    await verifyFixtureSentinel(database);
    const admin = database;
    return {
      name,
      url,
      async close() {
        try {
          const { stdout: label } = await docker(["inspect", "--format", '{{ index .Config.Labels "tools.runtime.fixture" }}', name]);
          if (label.trim() !== name) throw new Error("PostgreSQL fixture ownership does not match.");
          await verifyFixtureSentinel(admin);
          await docker(["stop", "--time", "10", name]);
          await docker(["rm", name]);
        } finally {
          await admin.end({ timeout: 1 });
        }
      },
    };
  } catch {
    await database?.end({ timeout: 1 });
    throw new Error(`BLOCKED postgres-fixture. Setup failed for ${name}. Inspect this owned container. No unverified cleanup was attempted.`);
  }
}
