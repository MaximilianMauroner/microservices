import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VerificationBlocked } from "./receipt.ts";
import { executeLogged, runVerification } from "./verification.ts";

const boundary = vi.hoisted(() => ({
  createOwnedPostgres: vi.fn(),
  rejectInheritedDataEndpoints: vi.fn(),
}));
vi.mock("./postgres.ts", () => ({
  createOwnedPostgres: boundary.createOwnedPostgres,
  rejectInheritedDataEndpoints: boundary.rejectInheritedDataEndpoints,
}));

const secret = "fixture-secret-7d1c9a52e8";
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

async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error("Condition did not become true within 30 seconds.");
}

function isGone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

describe("logged commands", () => {
  it.each(["ENOENT", "Cannot find module './missing'", "BLOCKED ERR_MODULE_NOT_FOUND"])("returns the exit status of a started command despite %s in its output", async (diagnostic) => {
    const log = join(directory, "command.log");
    expect(await executeLogged(process.execPath, ["-e", `console.error(${JSON.stringify(diagnostic)}); process.exit(2)`], log, {})).toBe(2);
    expect(await readFile(log, "utf8")).toContain(diagnostic);
  });

  it("blocks an actual missing executable with nonzero evidence", async () => {
    const log = join(directory, "spawn.log");
    await expect(executeLogged(join(directory, "missing-executable"), [], log, {})).rejects.toBeInstanceOf(VerificationBlocked);
    expect(await readFile(log, "utf8")).toContain("ENOENT");
  });

  async function startStubbornGroup(signals: { signal: AbortSignal; kill?: AbortSignal }) {
    const marks = join(directory, "terminated");
    const descendant = join(directory, "descendant.pid");
    const script = join(directory, "group.cjs");
    await writeFile(script, `const fs = require("node:fs");
const { spawn } = require("node:child_process");
const ignore = (name) => process.on("SIGTERM", () => fs.appendFileSync(process.env.MARKS, name + "\\n"));
if (process.argv[2] === "descendant") {
  ignore("descendant");
  fs.writeFileSync(process.env.DESCENDANT, String(process.pid));
} else {
  ignore("leader");
  spawn(process.execPath, [__filename, "descendant"], { stdio: "inherit" });
}
setInterval(() => {}, 1000);
`);
    const run = executeLogged(process.execPath, [script], join(directory, "group.log"), { env: { ...process.env, MARKS: marks, DESCENDANT: descendant }, ...signals });
    await waitFor(async () => Boolean(await readFile(descendant, "utf8").catch(() => "")));
    return { run, marks, descendantPid: Number(await readFile(descendant, "utf8")) };
  }

  it("sends SIGTERM to the whole group and kills it after a bounded wait", async () => {
    const stop = new AbortController();
    const { run, marks, descendantPid } = await startStubbornGroup({ signal: stop.signal });
    stop.abort();
    expect(await run).toBe(137);
    expect((await readFile(marks, "utf8")).trim().split("\n").sort()).toEqual(["descendant", "leader"]);
    await waitFor(async () => isGone(descendantPid));
  }, 20_000);

  it("kills a group that ignores SIGTERM as soon as a second signal arrives", async () => {
    const stop = new AbortController();
    const kill = new AbortController();
    const { run, marks, descendantPid } = await startStubbornGroup({ signal: stop.signal, kill: kill.signal });
    stop.abort();
    await waitFor(async () => (await readFile(marks, "utf8").catch(() => "")).trim().split("\n").length === 2);
    const killed = Date.now();
    kill.abort();
    expect(await run).toBe(137);
    expect(Date.now() - killed).toBeLessThan(2_000);
    await waitFor(async () => isGone(descendantPid));
  }, 20_000);
});

async function listen(onConnection: (socket: Socket, count: number) => void) {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    onConnection(socket, sockets.length);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    sockets,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

let rejecting: Awaited<ReturnType<typeof listen>>;
beforeAll(async () => {
  rejecting = await listen((socket) => socket.once("data", () => {
    const fields = Buffer.from("SFATAL\0C28P01\0Mpassword authentication failed\0\0");
    const header = Buffer.alloc(5);
    header[0] = "E".charCodeAt(0);
    header.writeInt32BE(fields.length + 4, 1);
    socket.end(Buffer.concat([header, fields]));
  }));
});
afterAll(async () => {
  await rejecting.close();
});

async function prepareRunner(port = rejecting.port) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const trace = join(directory, "commands.jsonl");
  const pnpm = join(directory, "pnpm");
  await writeFile(pnpm, `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.RUNTIME_COMMAND_TRACE, JSON.stringify(process.argv.slice(2)) + '\\n');
console.log('database ' + process.env.TEST_DATABASE_URL);
if (process.argv[3] === process.env.RUNTIME_HANG_COMMAND) {
  process.on('SIGTERM', () => {});
  fs.writeFileSync(process.env.RUNTIME_HANG_READY, String(process.pid));
  setInterval(() => {}, 1000);
}
if (process.argv[3] === process.env.RUNTIME_FAIL_COMMAND) {
  console.error("Cannot find module './broken' ENOENT");
  process.exit(2);
}
`);
  await chmod(pnpm, 0o700);
  vi.stubEnv("PATH", `${directory}:${process.env.PATH}`);
  vi.stubEnv("RUNTIME_COMMAND_TRACE", trace);
  const close = vi.fn(async () => {});
  const fixture = { name: "owned-test-fixture", url: `postgres://tools_runtime:${secret}@127.0.0.1:${port}/tools_runtime`, close };
  boundary.createOwnedPostgres.mockResolvedValue(fixture);
  return { close, trace, fixture };
}

describe("verification with the real Vitest child", () => {
  it("keeps actual failed contract outcomes, cleans up once and persists redacted receipts", async () => {
    const { trace, close } = await prepareRunner();
    const result = await verify("money-postgres");
    expect((await readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line))).toEqual([["run", "db:push-postgres:test"]]);
    expect(result.receipts.map(({ scenario }) => scenario)).toEqual(["schema", "required-contracts", "cleanup"]);
    const required = JSON.parse(await readFile(join(result.directory, "required.json"), "utf8"));
    expect(required.length).toBeGreaterThan(0);
    expect(result.receipts[1]).toMatchObject({ result: "failed", exitStatus: 1, required, executed: required, skipped: [] });
    expect(result.receipts[1]?.evidence).toContain(`failed: ${required[0]}`);
    expect(close).toHaveBeenCalledOnce();
    expect(result.exitStatus).toBe(1);
    expect(JSON.parse(await readFile(join(result.directory, "receipts.json"), "utf8"))).toEqual(result.receipts);
    for (const file of ["receipts.json", "schema.log", "run.log", "run-report.json"]) {
      expect(await readFile(join(result.directory, file), "utf8")).not.toContain(secret);
    }
    expect(await readFile(join(result.directory, "schema.log"), "utf8")).toContain("database [owned-postgres]");
  }, 60_000);

  it("records workspace failure without attaching Money case identities", async () => {
    const { close } = await prepareRunner();
    vi.stubEnv("RUNTIME_FAIL_COMMAND", "typecheck");
    const { receipts, exitStatus } = await verify("workspace");
    expect(receipts[0]).toMatchObject({ suite: "workspace", scenario: "typecheck", result: "failed", exitStatus: 1, required: [] });
    expect(close).toHaveBeenCalledOnce();
    expect(exitStatus).toBe(1);
  }, 60_000);

  it("fails discovery and creates no fixture when the child dies without a report", async () => {
    await prepareRunner();
    vi.stubEnv("NODE_OPTIONS", `--import=${join(directory, "missing-preload.mjs")}`);
    const { receipts } = await verify("money-postgres");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ scenario: "discover-required-cases", result: "failed", exitStatus: 1 });
    expect(receipts[0]?.evidence.join(" ")).toContain("discover child wrote no report");
    expect(boundary.createOwnedPostgres).not.toHaveBeenCalled();
  }, 60_000);

  it("stops the contract child on SIGTERM, then cleans up and records the interruption", async () => {
    const silent = await listen((_socket, count) => {
      if (count === 1) process.emit("SIGTERM");
    });
    try {
      const listeners = process.listenerCount("SIGTERM");
      const { close } = await prepareRunner(silent.port);
      const { receipts, exitStatus } = await verify("money-postgres");
      expect(silent.sockets.length).toBeGreaterThan(0);
      const contracts = receipts.find(({ scenario }) => scenario === "required-contracts");
      expect(contracts).toMatchObject({ result: "failed", exitStatus: 1 });
      expect(contracts?.evidence).toEqual(expect.arrayContaining([expect.stringContaining("run child exited 143"), "Vitest run child wrote no report."]));
      expect(close).toHaveBeenCalledOnce();
      expect(receipts.slice(-2)).toMatchObject([{ scenario: "cleanup", result: "passed" }, { scenario: "interrupted", exitStatus: 143 }]);
      expect(exitStatus).toBe(143);
      expect(process.listenerCount("SIGTERM")).toBe(listeners);
    } finally {
      await silent.close();
    }
  }, 60_000);

  it("kills a command that ignores SIGTERM as soon as a second signal arrives, then still cleans up", async () => {
    const { close } = await prepareRunner();
    const ready = join(directory, "hanging.pid");
    vi.stubEnv("RUNTIME_HANG_COMMAND", "db:push-postgres:test");
    vi.stubEnv("RUNTIME_HANG_READY", ready);
    const verification = verify("money-postgres");
    await waitFor(async () => Boolean(await readFile(ready, "utf8").catch(() => "")));
    process.emit("SIGINT");
    process.emit("SIGINT");
    const secondSignal = Date.now();
    const { receipts, exitStatus } = await verification;
    expect(Date.now() - secondSignal).toBeLessThan(3_000);
    expect(receipts[0]).toMatchObject({ scenario: "schema", result: "failed", exitStatus: 1 });
    expect(receipts[0]?.evidence.join(" ")).toContain("exited 137");
    expect(close).toHaveBeenCalledOnce();
    expect(receipts.slice(-2)).toMatchObject([{ scenario: "cleanup", result: "passed" }, { scenario: "interrupted", exitStatus: 130 }]);
    expect(exitStatus).toBe(130);
    await waitFor(async () => isGone(Number(await readFile(ready, "utf8"))));
  }, 60_000);

  it.each(["SIGINT", "SIGTERM"] as const)("records %s and closes a returned fixture before it returns", async (signal) => {
    const { close, fixture } = await prepareRunner();
    const listeners = process.listenerCount(signal);
    boundary.createOwnedPostgres.mockImplementationOnce(async () => {
      process.emit(signal);
      return fixture;
    });
    const { receipts, exitStatus } = await verify("money-postgres");
    expect(close).toHaveBeenCalledOnce();
    expect(receipts).toContainEqual(expect.objectContaining({ scenario: "cleanup", result: "passed" }));
    expect(receipts).toContainEqual(expect.objectContaining({ scenario: "interrupted", result: "failed", exitStatus: signal === "SIGINT" ? 130 : 143 }));
    expect(exitStatus).toBe(signal === "SIGINT" ? 130 : 143);
    expect(process.listenerCount(signal)).toBe(listeners);
  }, 60_000);

  it("keeps cleanup failures failed and redacts the fixture credentials from receipts and logs", async () => {
    const { close, fixture } = await prepareRunner();
    vi.stubEnv("RUNTIME_FAIL_COMMAND", "db:push-postgres:test");
    close.mockRejectedValueOnce(new Error(`sentinel failed ${fixture.url} ${secret}`));
    const { receipts, directory: receiptDirectory } = await verify("money-postgres");
    expect(receipts[0]).toMatchObject({ scenario: "schema", result: "failed", exitStatus: 1 });
    const cleanup = receipts.find(({ scenario }) => scenario === "cleanup");
    expect(cleanup).toMatchObject({ result: "failed", exitStatus: 1 });
    expect(cleanup?.evidence.join(" ")).toContain("sentinel failed [owned-postgres] [redacted]");
    for (const file of ["receipts.json", "schema.log"]) {
      expect(await readFile(join(receiptDirectory, file), "utf8")).not.toContain(secret);
    }
  }, 60_000);
});
