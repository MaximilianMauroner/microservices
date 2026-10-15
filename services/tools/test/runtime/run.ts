import { execFile, type ExecFileOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TestCase, TestModule, Vitest } from "vitest/node";
import { VerificationBlocked, isMissingExecutable, requiredCaseReceipt, type CaseResult, type CheckReceipt } from "./receipt.ts";

const execute = promisify(execFile);
const toolsRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = resolve(toolsRoot, "../..");
type VerificationMode = "workspace" | "money-postgres";

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

export async function executeLogged(
  command: string,
  args: string[],
  log: string,
  options: ExecFileOptions,
  redact = (text: string) => text,
) {
  try {
    const result = await execute(command, args, { ...options, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    await writeFile(log, redact(result.stdout + result.stderr));
  } catch (error) {
    const output = error as Error & { stdout?: string; stderr?: string };
    await writeFile(log, redact((output.stdout ?? "") + (output.stderr ?? "") + output.message));
    if (isMissingExecutable(error)) {
      throw new VerificationBlocked(`BLOCKED executable. ${command} could not start. See ${log}.`);
    }
    throw new Error(`Command ${command} failed. See ${log}.`);
  }
}

export async function runVerification(mode: VerificationMode) {
  const receipts: CheckReceipt[] = [];
  const directory = join(root, ".agents/artifacts/verify", `runtime-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  let context = { suite: "verification", scenario: "prerequisites", revision: "unknown", fixture: "none" };
  let required: string[] = [];
  let fixture: Awaited<ReturnType<typeof import("./postgres.ts").createOwnedPostgres>> | undefined;
  let activeVitest: Vitest | undefined;
  const controller = new AbortController();
  let interrupted: NodeJS.Signals | undefined;
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted ??= signal;
    controller.abort();
    void activeVitest?.cancelCurrentRun("keyboard-input");
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  const { signal } = controller;
  try {
    context.revision = (await execute("git", ["rev-parse", "HEAD"], { cwd: root, signal })).stdout.trim();
    if ((await execute("git", ["status", "--porcelain"], { cwd: root, signal })).stdout.trim()) context.revision += "+dirty";
    const { createVitest } = await import("vitest/node");
    const { createOwnedPostgres, rejectInheritedDataEndpoints } = await import("./postgres.ts");
    rejectInheritedDataEndpoints(process.env);
    const options = {
      root: toolsRoot,
      config: join(toolsRoot, "vitest.postgres.config.ts"),
      watch: false,
    };
    context = { ...context, suite: "money-postgres", scenario: "discover-required-cases" };
    const discovery = await createVitest("test", { ...options, reporters: [] });
    activeVitest = discovery;
    try {
      signal.throwIfAborted();
      const collected = await discovery.collectTests(await discovery.globTestSpecifications());
      if (collected.unhandledErrors.length || collected.testModules.some((module) => module.state() === "failed")) {
        throw new Error("Vitest could not collect the required Money contracts.");
      }
      required = collected.testModules.flatMap((module) => [...module.children.allTests()].map(identity));
      if (!required.length || new Set(required).size !== required.length) {
        throw new Error("Required Money case discovery returned zero or duplicate identities.");
      }
      await writeFile(join(directory, "required.json"), JSON.stringify(required, null, 2));
    } finally {
      await discovery.close();
      activeVitest = undefined;
    }

    signal.throwIfAborted();
    context = { ...context, suite: "money-postgres", scenario: "owned-fixture" };
    fixture = await createOwnedPostgres(process.env, signal);
    context.fixture = fixture.name;
    signal.throwIfAborted();

    if (mode === "workspace") {
      for (const command of ["typecheck", "test", "build"]) {
        context = { ...context, suite: "workspace", scenario: command };
        const log = join(directory, `${command}.log`);
        console.log(JSON.stringify({ ...context, event: "started", evidence: [log] }));
        await executeLogged("pnpm", ["run", command], log, { cwd: root, signal, timeout: 600_000 });
        receipts.push({ ...context, result: "passed", required: [], executed: [], skipped: [], exitStatus: 0, evidence: [log] });
      }
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
    await executeLogged("pnpm", ["run", "db:push-postgres:test"], schemaLog, { cwd: toolsRoot, env: environment, signal, timeout: 120_000 }, redact);
    receipts.push({ ...context, result: "passed", required: [], executed: [], skipped: [], exitStatus: 0, evidence: [schemaLog] });

    context.scenario = "required-contracts";
    const previous = { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, MONEY_TEST_DATABASE_CONFIRM: process.env.MONEY_TEST_DATABASE_CONFIRM };
    let receipt: CheckReceipt | undefined;
    try {
      process.env.TEST_DATABASE_URL = fixture.url;
      process.env.MONEY_TEST_DATABASE_CONFIRM = "money-repository-test";
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
      activeVitest = runtime;
      try {
        signal.throwIfAborted();
        await runtime.runTestSpecifications(await runtime.globTestSpecifications());
        if (!receipt) throw new Error("Vitest did not produce a required-contract reporter receipt.");
        receipts.push(receipt);
      } finally {
        await runtime.close();
        activeVitest = undefined;
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    receipts.push({ ...context, result: error instanceof VerificationBlocked || isMissingExecutable(error) ? "blocked" : "failed", required: context.suite === "money-postgres" ? required : [], executed: [], skipped: [], exitStatus: 1, evidence: [message] });
  } finally {
    if (fixture) {
      context = { ...context, suite: "money-postgres", scenario: "cleanup", fixture: fixture.name };
      try {
        await fixture.close();
        receipts.push({ ...context, result: "passed", required: [], executed: [], skipped: [], exitStatus: 0, evidence: ["Owned container stopped and removed after label and sentinel verification. No volumes were removed."] });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cause = message.replaceAll(fixture.url, "[owned-postgres]").replaceAll(new URL(fixture.url).password, "[redacted]");
        receipts.push({ ...context, result: "failed", required: [], executed: [], skipped: [], exitStatus: 1, evidence: [`Cleanup failed for ${fixture.name}. No unverified cleanup was attempted. ${cause}`] });
      }
    }
    if (interrupted) {
      receipts.push({ ...context, suite: "verification", scenario: "interrupted", result: "failed", required: [], executed: [], skipped: [], exitStatus: interrupted === "SIGINT" ? 130 : 143, evidence: [`Verification interrupted by ${interrupted}.`] });
    }
    const path = join(directory, "receipts.json");
    try {
      await writeFile(path, JSON.stringify(receipts, null, 2));
      console.log(JSON.stringify({ receipts, evidence: path }, null, 2));
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
  }
  return { receipts, directory };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "workspace";
  if (mode !== "workspace" && mode !== "money-postgres") throw new Error(`Unknown verification mode ${mode}.`);
  const { receipts } = await runVerification(mode);
  process.exitCode = Math.max(...receipts.map(({ exitStatus }) => exitStatus));
}
