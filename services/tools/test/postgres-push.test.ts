import { readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { consumePushHandoff, createPushHandoff, DISPOSABLE_DATABASE_SENTINEL, resolvePushDatabase, verifyDisposableDatabase, type PushMode } from "../database/postgres-push-guard.js";
import { moneyImportConstraintRepairs } from "../database/runtime-schema-reconciliation.js";

type Environment = Record<string, string | undefined>;
type PushInvocation = { mode: PushMode; environment: Environment };

const railwayDatabaseUrl = "postgres://user:pass@postgres.railway.internal:5432/railway";
const railwayProduction = { RAILWAY_ENVIRONMENT_NAME: "production", TOOLS_ENVIRONMENT: "production", NODE_ENV: "production", DATABASE_URL: railwayDatabaseUrl };
const railwayDev = { RAILWAY_ENVIRONMENT_NAME: "dev", TOOLS_ENVIRONMENT: "preview", NODE_ENV: "production", DATABASE_URL: railwayDatabaseUrl };
const noRailway = { NODE_ENV: "production", DATABASE_URL: railwayDatabaseUrl };

async function packageScripts() {
  return (JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }).scripts;
}

function splitAssignments(words: string[]) {
  const environment: Environment = {};
  let index = 0;
  for (; /^[A-Z_]+=/.test(words[index] ?? ""); index += 1) {
    const [name, value] = words[index]!.split("=", 2);
    environment[name!] = value;
  }
  return { environment, rest: words.slice(index) };
}

async function scriptInvocation(script: string, environment: Environment): Promise<PushInvocation> {
  const source = (await packageScripts())[script];
  if (!source) throw new Error(`Unknown Tools script ${script}.`);
  const expanded = splitAssignments(source.split(" "));
  const mode = expanded.rest[expanded.rest.indexOf("database/push-postgres.ts") + 1];
  return { mode: mode as PushMode, environment: { ...environment, ...expanded.environment } };
}

async function railwayInvocation(path: string) {
  const config = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as { deploy: { preDeployCommand: string[] } };
  const [push, backfill, ...rest] = config.deploy.preDeployCommand.join(" ").split(" && ");
  expect(backfill).toBe("pnpm --dir services/tools/publisher run db:backfill");
  expect(rest).toEqual([]);
  const { environment, rest: words } = splitAssignments(push!.split(" "));
  expect(words.slice(0, 4)).toEqual(["pnpm", "--dir", "services/tools", "run"]);
  expect(words).toHaveLength(5);
  return scriptInvocation(words[4]!, environment);
}

async function composeInvocation() {
  const source = await readFile(new URL("../../../compose.yaml", import.meta.url), "utf8");
  const service = source.split(/\n(?=  \S)/).find((block) => block.startsWith("  postgres-migrate:"));
  if (!service) throw new Error("compose.yaml has no postgres-migrate service.");
  const environment: Environment = {};
  for (const [, name, value] of service.split("environment:\n")[1]!.matchAll(/^ {6}([A-Z_]+): (.+)$/gm)) environment[name!] = value;
  const command = JSON.parse(service.match(/^ {4}command: (.+)$/m)![1]!) as string[];
  expect(command.slice(0, 4)).toEqual(["pnpm", "--dir", "services/tools", "run"]);
  expect(command).toHaveLength(5);
  return scriptInvocation(command[4]!, environment);
}

function push(invocation: PushInvocation, environment: Environment = {}) {
  return resolvePushDatabase({ ...environment, ...invocation.environment }, invocation.mode);
}

describe("Tools PostgreSQL schema push guard", () => {
  it("requires the explicit production confirmation", () => {
    const environment = { ...railwayProduction, TOOLS_SCHEMA_PUSH_CONFIRM: "tools-platform-production" };
    expect(resolvePushDatabase(environment, "production")).toBe(railwayDatabaseUrl);
    expect(() => resolvePushDatabase(railwayProduction, "production")).toThrow("TOOLS_SCHEMA_PUSH_CONFIRM=tools-platform-production");
  });

  it.each(["../../../railway.json", "../railway.json"])("runs the %s production push only in the Railway production environment", async (path) => {
    const invocation = await railwayInvocation(path);
    expect(push(invocation, railwayProduction)).toBe(railwayDatabaseUrl);
    expect(() => push(invocation, railwayDev)).toThrow("Production schema push requires RAILWAY_ENVIRONMENT_NAME=production.");
    expect(() => push(invocation, noRailway)).toThrow("Production schema push requires RAILWAY_ENVIRONMENT_NAME=production.");
  });

  it("runs the preview push only in a non-production Railway environment", async () => {
    const invocation = await railwayInvocation("../../../railway.preview.json");
    expect(push(invocation, railwayDev)).toBe(railwayDatabaseUrl);
    expect(() => push(invocation, railwayProduction)).toThrow("Preview schema push requires a non-production Railway environment.");
    expect(() => push(invocation, { ...railwayDev, TOOLS_ENVIRONMENT: "production" })).toThrow("Preview schema push is unavailable when TOOLS_ENVIRONMENT=production.");
    expect(() => push(invocation, noRailway)).toThrow("Preview schema push requires a non-production Railway environment.");
  });

  it("rejects public database addresses in preview even with preview confirmation", () => {
    expect(() => resolvePushDatabase({
      ...railwayDev,
      DATABASE_URL: "postgres://user:pass@production.proxy.rlwy.net:1234/railway",
      TOOLS_PREVIEW_SCHEMA_PUSH_CONFIRM: "tools-platform-preview",
    }, "preview")).toThrow("Preview schema push requires a database on the private Railway network.");
  });

  it("requires a separate preview confirmation", () => {
    expect(() => resolvePushDatabase(railwayDev, "preview")).toThrow("TOOLS_PREVIEW_SCHEMA_PUSH_CONFIRM=tools-platform-preview");
    expect(() => resolvePushDatabase({ ...railwayDev, TOOLS_SCHEMA_PUSH_CONFIRM: "tools-platform-production" }, "preview"))
      .toThrow("TOOLS_PREVIEW_SCHEMA_PUSH_CONFIRM=tools-platform-preview");
    const environment = { ...railwayDev, TOOLS_PREVIEW_SCHEMA_PUSH_CONFIRM: "tools-platform-preview" };
    expect(resolvePushDatabase(environment, "preview")).toBe(railwayDatabaseUrl);
    expect(resolvePushDatabase({ ...environment, RAILWAY_ENVIRONMENT_NAME: "pr-123" }, "preview")).toBe(railwayDatabaseUrl);
    expect(() => resolvePushDatabase({ ...environment, RAILWAY_ENVIRONMENT_NAME: " " }, "preview"))
      .toThrow("Preview schema push requires a non-production Railway environment.");
    expect(() => resolvePushDatabase({ ...railwayProduction, TOOLS_PREVIEW_SCHEMA_PUSH_CONFIRM: "tools-platform-preview" }, "production"))
      .toThrow("TOOLS_SCHEMA_PUSH_CONFIRM=tools-platform-production");
  });

  it.each([
    "production.proxy.rlwy.net,postgres.railway.internal",
    "postgres.railway.internal,production.proxy.rlwy.net",
    "first.railway.internal,second.railway.internal",
    "production.proxy.rlwy.net%2Cpostgres.railway.internal",
    "production.proxy.rlwy.net%2cpostgres.railway.internal",
    "production.proxy.rlwy.net%3A1234%2Cpostgres.railway.internal",
    "post%67res.railway.internal",
  ])("rejects unsafe preview database host syntax %s", (hosts) => {
    expect(() => resolvePushDatabase({
      ...railwayDev,
      DATABASE_URL: `postgres://user:pass@${hosts}:5432/railway`,
      TOOLS_PREVIEW_SCHEMA_PUSH_CONFIRM: "tools-platform-preview",
    }, "preview")).toThrow("Preview schema push requires a database on the private Railway network.");
  });

  it("consumes a preview handoff only once and checks its Railway environment again", async () => {
    const environment = { ...railwayDev, TOOLS_PREVIEW_SCHEMA_PUSH_CONFIRM: "tools-platform-preview" };
    const handoff = createPushHandoff(environment, "preview");
    const childEnvironment = {
      ...environment,
      TOOLS_SCHEMA_PUSH_HANDOFF: handoff.path,
      TOOLS_SCHEMA_PUSH_NONCE: handoff.nonce,
      TOOLS_SCHEMA_PUSH_MODE: handoff.mode,
    };
    try {
      expect(consumePushHandoff(childEnvironment)).toBe(railwayDatabaseUrl);
      expect(() => consumePushHandoff(childEnvironment)).toThrow();
    } finally {
      await rm(handoff.directory, { recursive: true, force: true });
    }
    const invalidHandoff = createPushHandoff(environment, "preview");
    try {
      expect(() => consumePushHandoff({
        ...childEnvironment,
        TOOLS_SCHEMA_PUSH_HANDOFF: invalidHandoff.path,
        TOOLS_SCHEMA_PUSH_NONCE: invalidHandoff.nonce,
        RAILWAY_ENVIRONMENT_NAME: "production",
      })).toThrow("Preview schema push requires a non-production Railway environment.");
    } finally {
      await rm(invalidHandoff.directory, { recursive: true, force: true });
    }
  });

  it("runs the local compose push in development mode against the compose PostgreSQL host", async () => {
    const invocation = await composeInvocation();
    expect(invocation.mode).toBe("development");
    expect(new URL(push(invocation)).hostname).toBe("postgres");
    expect(() => push({ ...invocation, environment: { ...invocation.environment, DATABASE_URL: railwayDatabaseUrl } }))
      .toThrow("Development schema push requires the Railway dev environment or a local PostgreSQL host.");
  });

  it("keeps the development environment and host restrictions", () => {
    const environment = {
      DATABASE_URL: "postgres://local:local@localhost/tools",
      TOOLS_ENVIRONMENT: "development",
      TOOLS_DEVELOPMENT_SCHEMA_PUSH_CONFIRM: "tools-platform-development",
    };
    expect(resolvePushDatabase(environment, "development")).toBe(environment.DATABASE_URL);
    expect(() => resolvePushDatabase({ ...environment, NODE_ENV: "production" }, "development"))
      .toThrow("Development schema push is unavailable when NODE_ENV=production.");
    expect(() => resolvePushDatabase({ ...environment, TOOLS_ENVIRONMENT: "production" }, "development"))
      .toThrow("Development schema push requires TOOLS_ENVIRONMENT=development.");
    expect(() => resolvePushDatabase({ ...environment, RAILWAY_ENVIRONMENT_NAME: "production" }, "development"))
      .toThrow("Development schema push may only target the Railway dev environment.");
  });

  it("protects disposable database operations with the Tools sentinel", async () => {
    await expect(verifyDisposableDatabase({
      readRelationKind: async () => "r",
      readValue: async () => DISPOSABLE_DATABASE_SENTINEL.value,
    })).resolves.toBeUndefined();
    await expect(verifyDisposableDatabase({
      readRelationKind: async () => "r",
      readValue: async () => "wrong-purpose",
    })).rejects.toThrow("Disposable database sentinel");
  });

  it("retains runtime constraint reconciliation", () => {
    expect(moneyImportConstraintRepairs([])).toEqual({ provider: true, format: true, category: true });
  });

  it("updates an existing import constraint for savings statements", () => {
    const before = [{ name: "money_imports_format_check", definition: "CHECK (format IN ('sparkasse_cash_statement_v1'))" }];
    expect(moneyImportConstraintRepairs(before).format).toBe(true);
    expect(moneyImportConstraintRepairs([{ ...before[0]!, definition: "CHECK (format IN ('sparkasse_cash_statement_v1', 'revolut_savings_statement_v1'))" }]).format).toBe(false);
  });
});
