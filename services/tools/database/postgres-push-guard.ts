import crypto from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DISPOSABLE_DATABASE_SENTINEL = {
  relation: "tools_runtime_test_sentinel",
  key: "database-purpose",
  value: "tools-runtime-disposable-test-database",
} as const;

export type PushMode = "production" | "development" | "test";
type Environment = Record<string, string | undefined>;
type PushHandoff = { directory: string; path: string; nonce: string; mode: PushMode };
type SentinelLookups = { readRelationKind: () => Promise<string | undefined>; readValue: () => Promise<string | undefined> };

export function resolvePushDatabase(environment: Environment, mode: PushMode) {
  const variable = mode === "test" ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const confirmationVariable = mode === "production"
    ? "TOOLS_SCHEMA_PUSH_CONFIRM"
    : mode === "development"
      ? "TOOLS_DEVELOPMENT_SCHEMA_PUSH_CONFIRM"
      : "TOOLS_TEST_DATABASE_CONFIRM";
  const confirmationValue = mode === "production"
    ? "tools-platform-production"
    : mode === "development"
      ? "tools-platform-development"
      : "tools-platform-test";
  const url = environment[variable]?.trim();
  if (!url) throw new Error(`${variable} is required for the ${mode} PostgreSQL schema push.`);
  if (environment[confirmationVariable] !== confirmationValue) {
    const label = mode === "production" ? "Production" : mode === "development" ? "Development" : "Disposable test";
    throw new Error(`${label} schema push requires ${confirmationVariable}=${confirmationValue}.`);
  }
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === "/") {
    throw new Error(`${variable} must be a valid PostgreSQL URL.`);
  }
  if (mode === "development") verifyDevelopmentEnvironment(environment, parsed.hostname);
  return url;
}

function verifyDevelopmentEnvironment(environment: Environment, databaseHostname: string) {
  if (environment.NODE_ENV === "production") throw new Error("Development schema push is unavailable when NODE_ENV=production.");
  if (environment.TOOLS_ENVIRONMENT !== "development") throw new Error("Development schema push requires TOOLS_ENVIRONMENT=development.");
  const railwayEnvironment = environment.RAILWAY_ENVIRONMENT_NAME?.trim();
  if (railwayEnvironment && railwayEnvironment !== "dev") throw new Error("Development schema push may only target the Railway dev environment.");
  if (!railwayEnvironment && !["localhost", "127.0.0.1", "::1", "postgres"].includes(databaseHostname)) {
    throw new Error("Development schema push requires the Railway dev environment or a local PostgreSQL host.");
  }
}

export async function verifyDisposableDatabase(lookups: SentinelLookups) {
  if (await lookups.readRelationKind() !== "r") throw new Error("Disposable database sentinel must be an existing regular table.");
  if (await lookups.readValue() !== DISPOSABLE_DATABASE_SENTINEL.value) throw new Error("Disposable database sentinel value is missing or invalid.");
}

export async function withVerifiedDisposableDatabase<Result>(lookups: SentinelLookups, run: () => Promise<Result>) {
  await verifyDisposableDatabase(lookups);
  return run();
}

export function createPushHandoff(environment: Environment, mode: PushMode): PushHandoff {
  const url = resolvePushDatabase(environment, mode);
  const directory = mkdtempSync(join(tmpdir(), "tools-schema-push-"));
  const path = join(directory, "handoff.json");
  const nonce = crypto.randomBytes(32).toString("hex");
  const databaseHash = crypto.createHash("sha256").update(url).digest("hex");
  writeFileSync(path, JSON.stringify({ nonce, mode, databaseHash }), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { directory, path, nonce, mode };
}

export function consumePushHandoff(environment: Environment) {
  const path = environment.TOOLS_SCHEMA_PUSH_HANDOFF?.trim();
  const nonce = environment.TOOLS_SCHEMA_PUSH_NONCE?.trim();
  const mode = environment.TOOLS_SCHEMA_PUSH_MODE;
  if (!path || !nonce || (mode !== "production" && mode !== "development" && mode !== "test")) {
    throw new Error("PostgreSQL schema push must run through the guarded db:push-postgres command.");
  }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) throw new Error("PostgreSQL schema push handoff is not a private regular file.");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) throw new Error("PostgreSQL schema push handoff has the wrong owner.");
  const source = readFileSync(path, "utf8");
  unlinkSync(path);
  const payload = JSON.parse(source) as { nonce?: unknown; mode?: unknown; databaseHash?: unknown };
  const expectedNonce = Buffer.from(nonce);
  const actualNonce = Buffer.from(typeof payload.nonce === "string" ? payload.nonce : "");
  if (expectedNonce.length !== actualNonce.length || !crypto.timingSafeEqual(expectedNonce, actualNonce) || payload.mode !== mode) {
    throw new Error("PostgreSQL schema push handoff is invalid.");
  }
  const url = resolvePushDatabase(environment, mode);
  const databaseHash = crypto.createHash("sha256").update(url).digest("hex");
  if (payload.databaseHash !== databaseHash) throw new Error("PostgreSQL schema push handoff database does not match.");
  return url;
}
