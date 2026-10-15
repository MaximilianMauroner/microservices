import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import postgres from "postgres";
import { waitForPostgres } from "../../database/postgres-readiness.ts";
import { VerificationBlocked, isMissingExecutable } from "./receipt.ts";
import { DISPOSABLE_DATABASE_SENTINEL, verifyDisposableDatabase } from "../../database/postgres-push-guard.ts";

const execute = promisify(execFile);
const dockerHost = "unix:///var/run/docker.sock";

export function rejectInheritedDataEndpoints(environment: NodeJS.ProcessEnv) {
  const names = Object.keys(environment).filter((name) => environment[name]?.trim() && (
    /(^|_)(DATABASE_URL|POSTGRES_URL|S3_ENDPOINT|S3_BUCKET)$/.test(name)
    || ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "DOCKER_HOST", "DOCKER_CONTEXT"].includes(name)
  ));
  if (environment.NODE_ENV === "production" || environment.TOOLS_ENVIRONMENT === "production") {
    throw new VerificationBlocked("BLOCKED production-environment. Verification requires a local test environment.");
  }
  if (names.length) throw new VerificationBlocked(`BLOCKED inherited-data-endpoints. Unset ${names.sort().join(", ")} before verification.`);
}

export function requireLoopbackPostgres(url: string) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    || !parsed.port || parsed.pathname.length < 2 || parsed.search || parsed.hash) {
    throw new VerificationBlocked("BLOCKED postgres-fixture. A loopback PostgreSQL URL with an explicit port and database is required.");
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

async function docker(args: string[], environment: NodeJS.ProcessEnv, signal?: AbortSignal) {
  return execute("docker", ["--host", dockerHost, ...args], { env: environment, signal, timeout: 120_000, maxBuffer: 1024 * 1024 });
}

function redactedCause(error: unknown, password?: string) {
  const output = error as Error & { code?: string; stderr?: string };
  const text = `${output.code ?? ""} ${output.message ?? String(error)} ${output.stderr ?? ""}`;
  return password ? text.replaceAll(password, "[redacted]") : text;
}

export async function createOwnedPostgres(environment: NodeJS.ProcessEnv, signal?: AbortSignal) {
  rejectInheritedDataEndpoints(environment);
  try {
    await docker(["info", "--format", "{{.ServerVersion}}"], environment, signal);
  } catch (error) {
    signal?.throwIfAborted();
    const cause = redactedCause(error);
    if (isMissingExecutable(error) || /Cannot connect to the Docker daemon|permission denied|Is the docker daemon running|error during connect/i.test(cause)) {
      throw new VerificationBlocked(`BLOCKED postgres-fixture. Docker must be installed and its local daemon must be available. ${cause}`);
    }
    throw new Error(`Docker prerequisite check failed. ${cause}`);
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
    ], { ...environment, POSTGRES_PASSWORD: password }, signal);
    const { stdout } = await docker(["port", name, "5432/tcp"], environment, signal);
    const port = /^127\.0\.0\.1:(\d+)\s*$/.exec(stdout)?.[1];
    if (!port) throw new Error("Docker did not publish an owned loopback PostgreSQL port.");
    const url = requireLoopbackPostgres(`postgres://tools_runtime:${password}@127.0.0.1:${port}/tools_runtime`);
    database = postgres(url, { max: 1, connect_timeout: 5 });
    const admin = database;
    await waitForPostgres(async () => {
      signal?.throwIfAborted();
      await admin`select 1`;
    }, undefined, (milliseconds) => setTimeout(milliseconds, undefined, { signal }));
    signal?.throwIfAborted();
    await database`create table public.tools_runtime_test_sentinel (sentinel_key text primary key, sentinel_value text not null)`;
    await database`insert into public.tools_runtime_test_sentinel values (${DISPOSABLE_DATABASE_SENTINEL.key}, ${DISPOSABLE_DATABASE_SENTINEL.value})`;
    await verifyFixtureSentinel(database);
    return {
      name,
      url,
      async close() {
        try {
          const { stdout: label } = await docker(["inspect", "--format", '{{ index .Config.Labels "tools.runtime.fixture" }}', name], environment);
          if (label.trim() !== name) throw new Error("PostgreSQL fixture ownership does not match.");
          await verifyFixtureSentinel(admin);
          await docker(["stop", "--time", "10", name], environment);
          await docker(["rm", name], environment);
        } finally {
          await admin.end({ timeout: 1 });
        }
      },
    };
  } catch (error) {
    await database?.end({ timeout: 1 });
    throw new Error(`PostgreSQL fixture setup failed for ${name}. Inspect this owned container. No unverified cleanup was attempted. ${redactedCause(error, password)}`);
  }
}
