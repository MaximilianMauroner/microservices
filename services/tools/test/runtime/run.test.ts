import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeLogged, runVerification } from "./run.ts";
import { VerificationBlocked } from "./receipt.ts";

const boundary = vi.hoisted(() => ({
  createVitest: vi.fn(),
  createOwnedPostgres: vi.fn(),
  rejectInheritedDataEndpoints: vi.fn(),
}));
vi.mock("vitest/node", () => ({ createVitest: boundary.createVitest }));
vi.mock("./postgres.ts", () => ({
  createOwnedPostgres: boundary.createOwnedPostgres,
  rejectInheritedDataEndpoints: boundary.rejectInheritedDataEndpoints,
}));

let directory: string;
let receiptDirectories: string[];
beforeEach(async () => {
  receiptDirectories = [];
  directory = await mkdtemp(join(tmpdir(), "runtime-command-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await rm(directory, { recursive: true, force: true });
  for (const path of receiptDirectories) await rm(path, { recursive: true, force: true });
});

async function verify(mode: Parameters<typeof runVerification>[0]) {
  const result = await runVerification(mode);
  receiptDirectories.push(result.directory);
  return result;
}

describe("verification command failures", () => {
  it.each(["ENOENT", "Cannot find module './missing'", "BLOCKED ERR_MODULE_NOT_FOUND"])("keeps an exited code failure failed despite %s in its output", async (diagnostic) => {
    const log = join(directory, "command.log");
    const error = await executeLogged(process.execPath, ["-e", `console.error(${JSON.stringify(diagnostic)}); process.exit(2)`], log, {}).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(VerificationBlocked);
    expect(await readFile(log, "utf8")).toContain(diagnostic);
  });

  it("blocks an actual missing executable with nonzero evidence", async () => {
    const log = join(directory, "spawn.log");
    await expect(executeLogged(join(directory, "missing-executable"), [], log, {})).rejects.toBeInstanceOf(VerificationBlocked);
    expect(await readFile(log, "utf8")).toContain("ENOENT");
  });
});

async function prepareRunner() {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const trace = join(directory, "commands.jsonl");
  const pnpm = join(directory, "pnpm");
  await writeFile(pnpm, `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.RUNTIME_COMMAND_TRACE, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[3] === process.env.RUNTIME_FAIL_COMMAND) {
  console.error("Cannot find module './broken' ENOENT");
  process.exit(2);
}
`);
  await chmod(pnpm, 0o700);
  vi.stubEnv("PATH", `${directory}:${process.env.PATH}`);
  vi.stubEnv("RUNTIME_COMMAND_TRACE", trace);
  const test = {
    module: { moduleId: join(process.cwd(), "test/money-repository.integration.test.ts") },
    fullName: "Money contract",
    result: () => ({ state: "passed" }),
  };
  const module = { children: { allTests: () => [test] }, state: () => "passed" };
  const discovery = {
    globTestSpecifications: async () => [],
    collectTests: async () => ({ unhandledErrors: [] as Error[], testModules: [module] }),
    close: vi.fn(async () => {}),
  };
  boundary.createVitest.mockResolvedValueOnce(discovery).mockImplementationOnce(async (_mode, options) => ({
    globTestSpecifications: async () => [],
    runTestSpecifications: async () => options.reporters[1].onTestRunEnd([module], [], "passed"),
    close: async () => {},
  }));
  const close = vi.fn(async () => {});
  boundary.createOwnedPostgres.mockResolvedValue({ name: "owned-test-fixture", url: "postgres://user:secret@127.0.0.1:54321/test", close });
  return { close, trace, discovery };
}

describe("verification modes and receipts", () => {
  it("runs focused Money setup and contracts without workspace commands", async () => {
    const { trace, close } = await prepareRunner();
    const result = await verify("money-postgres");
    expect((await readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line))).toEqual([["run", "db:push-postgres:test"]]);
    expect(result.receipts.map(({ scenario }) => scenario)).toEqual(["schema", "required-contracts", "cleanup"]);
    expect(result.receipts.every(({ result }) => result === "passed")).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    const configs = boundary.createVitest.mock.calls.map(([, options]) => options.config);
    expect(new Set(configs).size).toBe(1);
    expect(configs[0]).toMatch(/vitest.postgres.config.ts$/);
    expect(JSON.parse(await readFile(join(result.directory, "receipts.json"), "utf8"))).toEqual(result.receipts);
  });

  it("records workspace failure without attaching Money case identities", async () => {
    const { close } = await prepareRunner();
    vi.stubEnv("RUNTIME_FAIL_COMMAND", "typecheck");
    const { receipts } = await verify("workspace");
    expect(receipts[0]).toMatchObject({ suite: "workspace", scenario: "typecheck", result: "failed", exitStatus: 1, required: [] });
    expect(close).toHaveBeenCalledOnce();
  });

  it("records failed discovery rather than treating module diagnostics as prerequisites", async () => {
    const { discovery, close } = await prepareRunner();
    discovery.collectTests = async () => ({ unhandledErrors: [new Error("BLOCKED Cannot find module")], testModules: [] });
    const { receipts } = await verify("money-postgres");
    expect(receipts[0]).toMatchObject({ scenario: "discover-required-cases", result: "failed", exitStatus: 1 });
    expect(boundary.createOwnedPostgres).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("cancels active contracts on SIGTERM before guarded fixture cleanup", async () => {
    const { discovery, close } = await prepareRunner();
    const cancel = vi.fn(async () => {});
    const runtimeClose = vi.fn(async () => {});
    boundary.createVitest.mockReset().mockResolvedValueOnce(discovery).mockResolvedValueOnce({
      globTestSpecifications: async () => [],
      runTestSpecifications: () => new Promise<void>((resolve) => {
        cancel.mockImplementationOnce(async () => resolve());
        setImmediate(() => process.emit("SIGTERM"));
      }),
      cancelCurrentRun: cancel,
      close: runtimeClose,
    });
    const { receipts } = await verify("money-postgres");
    expect(cancel).toHaveBeenCalledOnce();
    expect(runtimeClose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(receipts).toContainEqual(expect.objectContaining({ scenario: "interrupted", exitStatus: 143 }));
  });

  it("keeps cleanup failures failed and redacts the returned fixture credentials", async () => {
    const { close } = await prepareRunner();
    close.mockRejectedValueOnce(new Error("sentinel failed postgres://user:secret@127.0.0.1:54321/test secret"));
    const { receipts } = await verify("money-postgres");
    const cleanup = receipts.find(({ scenario }) => scenario === "cleanup");
    expect(cleanup).toMatchObject({ result: "failed", exitStatus: 1 });
    expect(cleanup?.evidence.join(" ")).toContain("sentinel failed");
    expect(cleanup?.evidence.join(" ")).not.toContain("secret");
  });

  it.each(["SIGINT", "SIGTERM"] as const)("records %s and closes a returned fixture before it returns", async (signal) => {
    const { close } = await prepareRunner();
    const listeners = process.listenerCount(signal);
    boundary.createOwnedPostgres.mockImplementationOnce(async () => {
      process.emit(signal);
      return { name: "owned-test-fixture", url: "postgres://user:secret@127.0.0.1:54321/test", close };
    });
    const { receipts } = await verify("money-postgres");
    expect(close).toHaveBeenCalledOnce();
    expect(receipts).toContainEqual(expect.objectContaining({ scenario: "cleanup", result: "passed" }));
    expect(receipts).toContainEqual(expect.objectContaining({ scenario: "interrupted", result: "failed", exitStatus: signal === "SIGINT" ? 130 : 143 }));
    expect(process.listenerCount(signal)).toBe(listeners);
  });
});
