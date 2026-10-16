import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createOwnedPostgres, rejectInheritedDataEndpoints } from "./postgres.ts";
import { VerificationBlocked, decodeReport, isMissingExecutable, redactDatabase, requiredCaseReceipt, type CheckReceipt, type ChildReport } from "./receipt.ts";

const execute = promisify(execFile);
const toolsRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = resolve(toolsRoot, "../..");
const vitestChild = fileURLToPath(new URL("./vitest-child.ts", import.meta.url));
const terminationGrace = 5_000;
const interruptedStatus = { SIGINT: 130, SIGTERM: 143 } as const;

export type VerificationMode = "workspace" | "money-postgres";

type ChildOptions = Readonly<{
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  signal?: AbortSignal;
  kill?: AbortSignal;
}>;

export async function executeLogged(command: string, args: readonly string[], log: string, options: ChildOptions, redact = (text: string) => text) {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const output: Buffer[] = [];
  const notes: string[] = [];
  let spawnError: Error | undefined;
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
  child.once("error", (error) => {
    spawnError = error;
  });
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((settle) => child.once("close", (code, signal) => settle([code, signal])));
  const signalGroup = (name: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") notes.push(`Could not send ${name}. ${String(error)}`);
    }
  };
  const settled = new AbortController();
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      signalGroup("SIGTERM");
      const shortened = AbortSignal.any(options.kill ? [settled.signal, options.kill] : [settled.signal]);
      await delay(terminationGrace, undefined, { signal: shortened }).catch(() => {});
      signalGroup("SIGKILL");
    })();
  };
  const timer = options.timeout === undefined ? undefined : setTimeout(() => {
    notes.push(`Stopped after the ${options.timeout} ms time limit.`);
    stop();
  }, options.timeout);
  options.signal?.addEventListener("abort", stop);
  if (options.signal?.aborted) stop();
  const [code, signal] = await closed;
  settled.abort();
  clearTimeout(timer);
  options.signal?.removeEventListener("abort", stop);
  await stopping;
  const failure = spawnError && child.pid === undefined ? spawnError : undefined;
  await writeFile(log, redact([Buffer.concat(output).toString("utf8"), ...notes, ...(failure ? [failure.message] : [])].join("\n")));
  if (failure) {
    if (isMissingExecutable(failure)) throw new VerificationBlocked(`BLOCKED executable. ${command} could not start. See ${log}.`);
    throw new Error(`Command ${command} could not start. See ${log}.`);
  }
  return code ?? 128 + constants.signals[signal as keyof typeof constants.signals];
}

async function writeAtomic(path: string, text: string) {
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}

async function runVitestChild<Phase extends ChildReport["phase"]>(phase: Phase, directory: string, options: ChildOptions, redact: (text: string) => string) {
  const reportPath = join(directory, `${phase}-report.json`);
  const log = join(directory, `${phase}.log`);
  const status = await executeLogged(process.execPath, ["--experimental-strip-types", vitestChild, phase, reportPath], log, { ...options, cwd: toolsRoot }, redact);
  const errors = status === 0 ? [] : [`Vitest ${phase} child exited ${status}. See ${log}.`];
  const text = await readFile(reportPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  try {
    return { report: decodeReport(text, phase), errors };
  } catch (error) {
    return { report: undefined, errors: [...errors, (error as Error).message] };
  }
}

export async function runVerification(mode: VerificationMode) {
  const receipts: CheckReceipt[] = [];
  const directory = join(root, ".agents/artifacts/verify", `runtime-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  let context = { suite: "verification", scenario: "prerequisites", revision: "unknown", fixture: "none" };
  let required: readonly string[] = [];
  let fixture: Awaited<ReturnType<typeof createOwnedPostgres>> | undefined;
  const redact = (text: string) => redactDatabase(text, fixture?.url);
  const stop = new AbortController();
  const force = new AbortController();
  let interrupted: keyof typeof interruptedStatus | undefined;
  const interrupt = (signal: keyof typeof interruptedStatus) => {
    if (interrupted) force.abort();
    interrupted ??= signal;
    stop.abort();
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  const { signal } = stop;
  const children = { signal, kill: force.signal };
  try {
    context.revision = (await execute("git", ["rev-parse", "HEAD"], { cwd: root, signal })).stdout.trim();
    if ((await execute("git", ["status", "--porcelain"], { cwd: root, signal })).stdout.trim()) context.revision += "+dirty";
    rejectInheritedDataEndpoints(process.env);

    context = { ...context, suite: "money-postgres", scenario: "discover-required-cases" };
    const discovery = await runVitestChild("discover", directory, { ...children, env: process.env, timeout: 120_000 }, redact);
    const discoveryErrors = [...discovery.errors, ...discovery.report?.errors ?? []];
    if (!discovery.report || discoveryErrors.length) {
      throw new Error(["Vitest could not collect the required Money contracts.", ...discoveryErrors].join(" "));
    }
    required = discovery.report.required;
    if (!required.length || new Set(required).size !== required.length) {
      throw new Error("Required Money case discovery returned zero or duplicate identities.");
    }
    await writeAtomic(join(directory, "required.json"), JSON.stringify(required, null, 2));

    signal.throwIfAborted();
    context = { ...context, scenario: "owned-fixture" };
    fixture = await createOwnedPostgres(process.env, signal);
    context.fixture = fixture.name;
    signal.throwIfAborted();

    if (mode === "workspace") {
      for (const command of ["typecheck", "test", "build"]) {
        context = { ...context, suite: "workspace", scenario: command };
        const log = join(directory, `${command}.log`);
        console.log(JSON.stringify({ ...context, event: "started", evidence: [log] }));
        const status = await executeLogged("pnpm", ["run", command], log, { ...children, cwd: root, timeout: 600_000 }, redact);
        if (status !== 0) throw new Error(`Command pnpm run ${command} exited ${status}. See ${log}.`);
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
    const schemaStatus = await executeLogged("pnpm", ["run", "db:push-postgres:test"], schemaLog, { ...children, cwd: toolsRoot, env: environment, timeout: 120_000 }, redact);
    if (schemaStatus !== 0) throw new Error(`Command pnpm run db:push-postgres:test exited ${schemaStatus}. See ${schemaLog}.`);
    receipts.push({ ...context, result: "passed", required: [], executed: [], skipped: [], exitStatus: 0, evidence: [schemaLog] });

    signal.throwIfAborted();
    context = { ...context, scenario: "required-contracts" };
    const contracts = await runVitestChild("run", directory, { ...children, env: environment, timeout: 600_000 }, redact);
    receipts.push(requiredCaseReceipt(context, required, contracts.report?.observed ?? [], [...contracts.errors, ...contracts.report?.errors ?? []]));
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    receipts.push({ ...context, result: error instanceof VerificationBlocked || isMissingExecutable(error) ? "blocked" : "failed", required: context.suite === "money-postgres" ? required : [], executed: [], skipped: [], exitStatus: 1, evidence: [message] });
  } finally {
    if (fixture) {
      context = { ...context, suite: "money-postgres", scenario: "cleanup", fixture: fixture.name };
      try {
        await fixture.close();
        receipts.push({ ...context, result: "passed", required: [], executed: [], skipped: [], exitStatus: 0, evidence: ["Owned container stopped and removed after label and sentinel verification. No volumes were removed."] });
      } catch (error) {
        const cause = redact(error instanceof Error ? error.message : String(error));
        receipts.push({ ...context, result: "failed", required: [], executed: [], skipped: [], exitStatus: 1, evidence: [`Cleanup failed for ${fixture.name}. No unverified cleanup was attempted. ${cause}`] });
      }
    }
    if (interrupted) {
      receipts.push({ ...context, suite: "verification", scenario: "interrupted", result: "failed", required: [], executed: [], skipped: [], exitStatus: interruptedStatus[interrupted], evidence: [`Verification interrupted by ${interrupted}.`] });
    }
    const path = join(directory, "receipts.json");
    try {
      await writeAtomic(path, JSON.stringify(receipts, null, 2));
      console.log(JSON.stringify({ receipts, evidence: path }, null, 2));
    } finally {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
  }
  const exitStatus = interrupted ? interruptedStatus[interrupted] : Math.max(0, ...receipts.map((receipt) => receipt.exitStatus));
  return { receipts, directory, exitStatus };
}
