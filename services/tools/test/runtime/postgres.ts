import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandExecutor, CommandOutcome, CommandSpec } from "./commands.ts";
import { VerificationBlocked, redactDatabase } from "./receipt.ts";

export type FixtureCleanup =
  | { kind: "cleaned"; name: string }
  | { kind: "retained" | "failed"; name: string; reason: string };

export type FixtureSetup =
  | { kind: "ready"; fixture: { name: string; url: string; close(): Promise<FixtureCleanup> } }
  | { kind: "failed" | "blocked"; reason: string }
  | { kind: "retained-unverified"; name: string; reason: string };

const dockerHost = "unix:///var/run/docker.sock";
const queryEntry = fileURLToPath(new URL("./postgres-query.ts", import.meta.url));
const toolsDirectory = fileURLToPath(new URL("../../", import.meta.url));

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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VerificationBlocked("BLOCKED postgres-fixture. A valid PostgreSQL URL is required.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    || !parsed.port || parsed.pathname.length < 2 || parsed.search || parsed.hash) {
    throw new VerificationBlocked("BLOCKED postgres-fixture. A loopback PostgreSQL URL with an explicit port and database is required.");
  }
  return url;
}

export async function createOwnedPostgres(
  environment: NodeJS.ProcessEnv,
  commands: { work: CommandExecutor; cleanup: CommandExecutor },
  directory: string,
  signal?: AbortSignal,
): Promise<FixtureSetup> {
  try {
    rejectInheritedDataEndpoints(environment);
  } catch (error) {
    return { kind: "blocked", reason: error instanceof VerificationBlocked ? error.message : "PostgreSQL environment check failed." };
  }
  if (signal?.aborted) return { kind: "failed", reason: "PostgreSQL setup was interrupted before container creation." };
  const localEnvironment = { ...environment };
  const password = randomBytes(32).toString("hex");
  let url: string | undefined;
  const redact = (text: string) => redactDatabase(text, url).replaceAll(password, "[redacted]");
  const failure = (outcome: Exclude<CommandOutcome, { kind: "succeeded" }>) => redact(
    outcome.kind === "not-started" ? outcome.reason : outcome.reasons.join("; "),
  ) || "Command did not complete successfully.";
  async function execute(executor: CommandExecutor, spec: CommandSpec): Promise<CommandOutcome> {
    try {
      return await executor.execute(spec);
    } catch {
      return {
        kind: "failed", termination: { kind: "owner", reason: "anchor-failed" },
        exit: { kind: "unavailable", reason: "Command executor failed." }, escalation: "none",
        ownership: "uncertain", log: { kind: "failed", path: spec.log, reason: "Command executor failed." },
        reasons: ["Command executor failed."],
      };
    }
  }
  function docker(executor: CommandExecutor, args: readonly string[], step: string, deadlineMs: number, env = localEnvironment, commandSignal?: AbortSignal) {
    return execute(executor, {
      command: "docker", args: ["--host", dockerHost, ...args], env,
      deadlineMs, log: join(directory, `postgres-${step}.log`), signal: commandSignal, redact,
    });
  }
  function query(executor: CommandExecutor, operation: "ready" | "initialize" | "verify", deadlineMs: number, commandSignal?: AbortSignal, step = operation as string) {
    return execute(executor, {
      command: process.execPath, args: ["--import", "tsx", queryEntry, operation], cwd: toolsDirectory,
      env: { ...localEnvironment, TOOLS_RUNTIME_POSTGRES_URL: url },
      deadlineMs, log: join(directory, `postgres-${step}.log`), signal: commandSignal, redact,
    });
  }
  const prerequisite = await docker(commands.work, ["info", "--format", "{{.ServerVersion}}"], "prerequisite", 10_000, localEnvironment, signal);
  if (prerequisite.kind !== "succeeded") {
    const unavailable = prerequisite.kind === "blocked" || prerequisite.kind === "failed"
      && prerequisite.termination.kind === "natural" && prerequisite.ownership === "released"
      && prerequisite.exit.kind === "exited" && prerequisite.exit.code !== 0;
    return {
      kind: unavailable ? "blocked" : "failed",
      reason: `Docker prerequisite did not pass. ${failure(prerequisite)}`,
    };
  }
  if (signal?.aborted) return { kind: "failed", reason: "PostgreSQL setup was interrupted before container creation." };
  const name = `tools-runtime-${randomUUID()}`;
  const retain = (reason: string): FixtureSetup => ({ kind: "retained-unverified", name, reason: redact(reason) });
  const launched = await docker(commands.work, [
    "run", "--detach", "--name", name, "--label", `tools.runtime.fixture=${name}`,
    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw",
    "--env", "POSTGRES_USER=tools_runtime", "--env", "POSTGRES_DB=tools_runtime",
    "--env", "POSTGRES_PASSWORD", "postgres:16-alpine",
  ], "create", 120_000, { ...localEnvironment, POSTGRES_PASSWORD: password }, signal);
  if (launched.kind === "not-started") return { kind: "failed", reason: failure(launched) };
  if (launched.kind !== "succeeded") return retain(`Container creation did not complete. ${failure(launched)}`);
  if (signal?.aborted) return retain("PostgreSQL setup was interrupted after container creation.");
  const published = await docker(commands.work, ["port", name, "5432/tcp"], "port", 10_000, localEnvironment, signal);
  if (published.kind !== "succeeded") return retain(`Published port lookup failed. ${failure(published)}`);
  const port = /^127\.0\.0\.1:([1-9]\d{0,4})\s*$/.exec(published.stdout)?.[1];
  if (!port || Number(port) > 65_535) return retain("Docker did not publish an owned loopback PostgreSQL port.");
  url = requireLoopbackPostgres(`postgres://tools_runtime:${password}@127.0.0.1:${port}/tools_runtime`);
  for (const operation of ["ready", "initialize", "verify"] as const) {
    if (signal?.aborted) return retain("PostgreSQL setup was interrupted before sentinel verification.");
    const result = await query(commands.work, operation, operation === "ready" ? 75_000 : 10_000, signal);
    if (result.kind !== "succeeded") return retain(`PostgreSQL ${operation} failed. ${failure(result)}`);
    if (result.stdout !== `${operation}\n`) return retain(`PostgreSQL ${operation} returned an invalid result.`);
  }
  if (signal?.aborted) return retain("PostgreSQL setup was interrupted after sentinel verification.");
  let closing: Promise<FixtureCleanup> | undefined;
  async function close(): Promise<FixtureCleanup> {
    const label = await docker(commands.cleanup, ["inspect", "--format", '{{ index .Config.Labels "tools.runtime.fixture" }}', name], "label", 10_000);
    if (label.kind !== "succeeded") return { kind: "retained", name, reason: `Container ownership could not be read. ${failure(label)}` };
    if (label.stdout.trim() !== name) return { kind: "retained", name, reason: "PostgreSQL fixture ownership does not match." };
    const sentinel = await query(commands.cleanup, "verify", 10_000, undefined, "cleanup-verify");
    if (sentinel.kind !== "succeeded") return { kind: "retained", name, reason: `Sentinel verification failed. ${failure(sentinel)}` };
    if (sentinel.stdout !== "verify\n") return { kind: "retained", name, reason: "Sentinel verification returned an invalid result." };
    const stopped = await docker(commands.cleanup, ["stop", "--time", "10", name], "stop", 20_000);
    if (stopped.kind !== "succeeded") return { kind: "failed", name, reason: `Container stop failed. ${failure(stopped)}` };
    const removed = await docker(commands.cleanup, ["rm", name], "remove", 10_000);
    if (removed.kind !== "succeeded") return { kind: "failed", name, reason: `Container removal failed. ${failure(removed)}` };
    return { kind: "cleaned", name };
  }
  return { kind: "ready", fixture: { name, url, close: () => closing ??= close() } };
}
