import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL } from "../../database/postgres-push-guard.ts";
import { createOwnedPostgres } from "./postgres.ts";
import { VerificationBlocked } from "./receipt.ts";

const driver = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("postgres", () => ({ default: driver.connect }));

let directory: string;
let trace: string;
let environment: NodeJS.ProcessEnv;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "runtime-postgres-"));
  trace = join(directory, "docker.jsonl");
  const executable = join(directory, "docker");
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(4);
fs.appendFileSync(process.env.RUNTIME_DOCKER_TRACE, JSON.stringify(args) + '\\n');
if (args[0] === 'run') {
  fs.writeFileSync(process.env.RUNTIME_FIXTURE_NAME, args[args.indexOf('--name') + 1]);
  if (process.env.RUNTIME_FAIL_SETUP) {
    console.error('setup diagnostic ' + process.env.POSTGRES_PASSWORD);
    process.exit(2);
  }
}
if (args[0] === 'port') console.log('127.0.0.1:54321');
if (args[0] === 'inspect') console.log(process.env.RUNTIME_WRONG_LABEL || fs.readFileSync(process.env.RUNTIME_FIXTURE_NAME, 'utf8'));
`);
  await chmod(executable, 0o700);
  environment = { PATH: directory, RUNTIME_DOCKER_TRACE: trace, RUNTIME_FIXTURE_NAME: join(directory, "name") };
});
afterEach(async () => {
  vi.resetAllMocks();
  await rm(directory, { recursive: true, force: true });
});

async function commands() {
  return (await readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
}

function database() {
  const query = vi.fn(async (strings: TemplateStringsArray): Promise<Record<string, string>[]> => {
    if (strings.join("").includes("relkind")) return [{ kind: "r" }];
    if (strings.join("").includes("select sentinel_value")) return [{ value: DISPOSABLE_DATABASE_SENTINEL.value }];
    return [];
  });
  const end = vi.fn(async () => {});
  driver.connect.mockReturnValue(Object.assign(query, { end }));
  return { query, end };
}

describe("owned PostgreSQL lifecycle boundaries", () => {
  it("stops and removes only after both ownership checks pass", async () => {
    const { end } = database();
    const fixture = await createOwnedPostgres(environment);
    await fixture.close();
    const effects = await commands();
    expect(effects.filter(([command]) => command === "stop" || command === "rm")).toEqual([["stop", "--time", "10", fixture.name], ["rm", fixture.name]]);
    expect(effects.flat()).not.toContain("--rm");
    expect(end).toHaveBeenCalledOnce();
  });

  it.each(["wrong-label", "missing-sentinel", "wrong-sentinel", "unreadable-sentinel"])("retains the container for %s", async (failure) => {
    const { query, end } = database();
    const fixture = await createOwnedPostgres(environment);
    if (failure === "wrong-label") environment.RUNTIME_WRONG_LABEL = "some-other-owner";
    if (failure === "missing-sentinel") query.mockResolvedValue([]);
    if (failure === "wrong-sentinel") query.mockImplementation(async (strings) => strings.join("").includes("relkind") ? [{ kind: "r" }] : [{ value: "wrong-purpose" }]);
    if (failure === "unreadable-sentinel") query.mockRejectedValue(new Error("database unreachable"));
    await expect(fixture.close()).rejects.toBeInstanceOf(Error);
    expect((await commands()).some(([command]) => command === "stop" || command === "rm")).toBe(false);
    expect(end).toHaveBeenCalledOnce();
  });

  it("reports sentinel setup defects as failed and keeps their cause", async () => {
    const { query } = database();
    query.mockResolvedValue([]);
    const error = await createOwnedPostgres(environment).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(VerificationBlocked);
    expect((error as Error).message).toContain("sentinel must be an existing regular table");
    expect((await commands()).some(([command]) => command === "stop" || command === "rm")).toBe(false);
  });

  it("keeps setup diagnostics and redacts the fixture password", async () => {
    environment.RUNTIME_FAIL_SETUP = "1";
    const error = await createOwnedPostgres(environment).catch((error: unknown) => error);
    expect(error).not.toBeInstanceOf(VerificationBlocked);
    expect((error as Error).message).toContain("setup diagnostic [redacted]");
    expect((error as Error).message).not.toMatch(/[a-f0-9]{64}/);
    expect((await commands()).some(([command]) => command === "stop" || command === "rm")).toBe(false);
  });
});
