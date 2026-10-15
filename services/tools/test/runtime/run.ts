import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TestCase, TestModule } from "vitest/node";
import { requiredCaseReceipt, type CaseResult, type CheckReceipt } from "./receipt.ts";

const execute = promisify(execFile);
const toolsRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = resolve(toolsRoot, "../..");
const integrationFile = "test/money-repository.integration.test.ts";

function identity(test: TestCase) {
  return `${relative(toolsRoot, test.module.moduleId)} > ${test.fullName}`;
}

function reportedCases(modules: readonly TestModule[]): CaseResult[] {
  return modules.flatMap((module) => [...module.children.allTests()].map((test) => ({
    identity: identity(test),
    result: test.result().state,
    evidence: test.result().errors?.map((error) => error.message) ?? [],
  })));
}

async function runVerification() {
  const receipts: CheckReceipt[] = [];
  const directory = join(root, ".agents/artifacts/r1", `runtime-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  let context = { suite: "verification", scenario: "prerequisites", revision: "unknown", fixture: "none" };
  let required: string[] = [];
  let fixture: Awaited<ReturnType<typeof import("./postgres.ts").createOwnedPostgres>> | undefined;
  try {
    context.revision = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    if ((await execute("git", ["status", "--porcelain"], { cwd: root })).stdout.trim()) context.revision += "+dirty";
    const { createVitest } = await import("vitest/node");
    const { createOwnedPostgres, rejectInheritedDataEndpoints } = await import("./postgres.ts");
    rejectInheritedDataEndpoints(process.env);
    const options = {
      root: toolsRoot,
      config: join(toolsRoot, "vitest.config.ts"),
      include: [integrationFile],
      exclude: [],
      watch: false,
      maxWorkers: 1,
      fileParallelism: false,
      allowOnly: false,
      passWithNoTests: false,
      retry: 0,
      testNamePattern: "",
    };
    context = { ...context, suite: "money-postgres", scenario: "discover-required-cases" };
    const discovery = await createVitest("test", { ...options, reporters: [] });
    try {
      const collected = await discovery.collectTests(await discovery.globTestSpecifications());
      if (collected.unhandledErrors.length || collected.testModules.some((module) => module.state() === "failed")) {
        throw new Error("BLOCKED money-postgres. Vitest could not collect the required contracts.");
      }
      required = collected.testModules.flatMap((module) => [...module.children.allTests()].map(identity));
      if (!required.length || new Set(required).size !== required.length) {
        throw new Error("Required Money case discovery returned zero or duplicate identities.");
      }
      await writeFile(join(directory, "required.json"), JSON.stringify(required, null, 2));
    } finally {
      await discovery.close();
    }

    context = { ...context, suite: "money-postgres", scenario: "owned-fixture" };
    fixture = await createOwnedPostgres(process.env);
    context.fixture = fixture.name;

    for (const command of ["typecheck", "test", "build"]) {
      context = { ...context, suite: "workspace", scenario: command };
      const log = join(directory, `${command}.log`);
      console.log(JSON.stringify({ ...context, event: "started", evidence: [log] }));
      try {
        const result = await execute("pnpm", ["run", command], { cwd: root, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
        await writeFile(log, result.stdout + result.stderr);
      } catch (error) {
        const output = error as Error & { stdout?: string; stderr?: string };
        const text = (output.stdout ?? "") + (output.stderr ?? "") + output.message;
        await writeFile(log, text);
        if (/ENOENT|command not found|ERR_MODULE_NOT_FOUND|Cannot find (package|module)/.test(text)) {
          throw new Error(`BLOCKED workspace-dependencies. Workspace ${command} could not start. See ${log}.`);
        }
        throw new Error(`Workspace ${command} failed. See ${log}.`);
      }
      receipts.push({ ...context, result: "passed", required: [], executed: [], skipped: [], exitStatus: 0, evidence: [log] });
    }

    context = { ...context, suite: "money-postgres", scenario: "schema" };
    const environment = {
      ...process.env,
      TEST_DATABASE_URL: fixture.url,
      TOOLS_TEST_DATABASE_CONFIRM: "tools-platform-test",
      MONEY_TEST_DATABASE_CONFIRM: "money-repository-test",
    };
    const schemaLog = join(directory, "schema.log");
    const fixtureUrl = fixture.url;
    const redact = (text: string) => text.replaceAll(fixtureUrl, "[owned-postgres]").replaceAll(new URL(fixtureUrl).password, "[redacted]");
    try {
      const schema = await execute("pnpm", ["run", "db:push-postgres:test"], { cwd: toolsRoot, env: environment, timeout: 120_000 });
      await writeFile(schemaLog, redact(schema.stdout + schema.stderr));
    } catch (error) {
      const output = error as Error & { stdout?: string; stderr?: string };
      const text = redact((output.stdout ?? "") + (output.stderr ?? "") + output.message);
      await writeFile(schemaLog, text);
      const blocked = /ENOENT|command not found|ERR_MODULE_NOT_FOUND|Cannot find (package|module)/.test(text);
      throw new Error(`${blocked ? "BLOCKED schema-dependencies" : "Schema push failed"}. See ${schemaLog}.`);
    }
    receipts.push({ ...context, result: "passed", required: [], executed: [], skipped: [], exitStatus: 0, evidence: [schemaLog] });

    context.scenario = "required-contracts";
    const previous = { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, MONEY_TEST_DATABASE_CONFIRM: process.env.MONEY_TEST_DATABASE_CONFIRM };
    process.env.TEST_DATABASE_URL = fixture.url;
    process.env.MONEY_TEST_DATABASE_CONFIRM = "money-repository-test";
    let receipt: CheckReceipt | undefined;
    const runtime = await createVitest("test", {
      ...options,
      reporters: ["default", {
        onTestRunEnd(modules, errors, reason) {
          const runErrors = errors.map((error) => error.message);
          for (const module of modules) {
            if (module.state() !== "passed") runErrors.push(`Module ${relative(toolsRoot, module.moduleId)} ended ${module.state()}.`);
          }
          if (reason !== "passed") runErrors.push(`Vitest ended ${reason}.`);
          receipt = requiredCaseReceipt(context, required, reportedCases(modules), runErrors);
        },
      }],
    });
    try {
      await runtime.runTestSpecifications(await runtime.globTestSpecifications());
      if (!receipt) throw new Error("Vitest did not produce a required-contract reporter receipt.");
      receipts.push(receipt);
    } finally {
      await runtime.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const blocked = message.includes("BLOCKED") || /ENOENT|Cannot find (package|module)|ERR_MODULE_NOT_FOUND/.test(message);
    receipts.push({ ...context, result: blocked ? "blocked" : "failed", required, executed: [], skipped: [], exitStatus: 1, evidence: [message] });
  } finally {
    if (fixture) {
      context = { ...context, scenario: "cleanup", fixture: fixture.name };
      try {
        await fixture.close();
        receipts.push({ ...context, result: "passed", required: [], executed: [], skipped: [], exitStatus: 0, evidence: ["Owned container stopped and removed after sentinel verification. No volumes were removed."] });
      } catch {
        receipts.push({ ...context, result: "failed", required: [], executed: [], skipped: [], exitStatus: 1, evidence: [`Cleanup failed for ${fixture.name}. Inspect this owned container. No unverified cleanup was attempted.`] });
      }
    }
    const path = join(directory, "receipts.json");
    await writeFile(path, JSON.stringify(receipts, null, 2));
    console.log(JSON.stringify({ receipts, evidence: path }, null, 2));
    process.exitCode = receipts.some(({ result }) => result !== "passed") ? 1 : 0;
  }
}

await runVerification();
