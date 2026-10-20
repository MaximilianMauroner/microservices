import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOwnedCommands } from "./commands.ts";
import { decodeReport } from "./receipt.ts";

const tools = fileURLToPath(new URL("../../", import.meta.url));
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "runtime-vitest-child-"));
  await mkdir(join(scratch, "test/runtime"), { recursive: true });
  for (const file of ["vitest-child.ts", "receipt.ts"]) await copyFile(join(tools, "test/runtime", file), join(scratch, "test/runtime", file));
  await symlink(join(tools, "node_modules"), join(scratch, "node_modules"));
  await writeFile(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(scratch, "vitest.postgres.config.ts"), `export default { test: { include: ["test/cases.control.ts", "test/broken.control.ts"], maxWorkers: 1, fileParallelism: false, retry: 0 } };\n`);
  await writeFile(join(scratch, "test/cases.control.ts"), `import { afterAll, describe, expect, it } from "vitest";
it("passes", () => {});
it("fails", () => { expect([process.env.TEST_DATABASE_URL, process.env.TOWER_HEARTBEAT_TOKEN, process.env.TOOLS_S3_SECRET_ACCESS_KEY].join(" ")).toBe("another database"); });
it.skip("skips", () => {});
it.todo("todo");
describe("group", () => {
  it("leaks", async () => { void Promise.reject(new Error("unhandled-probe")); await new Promise((resolve) => setTimeout(resolve, 50)); });
  afterAll(() => { throw new Error("suite-afterAll-probe"); });
});
afterAll(() => { throw new Error("afterAll-probe"); });
`);
  await writeFile(join(scratch, "vitest.journeys.config.ts"), `export default { test: { include: ["test/blocked.control.ts"], maxWorkers: 1, fileParallelism: false, retry: 0 } };\n`);
  await writeFile(join(scratch, "test/blocked.control.ts"), `import { it } from "vitest";
import { VerificationBlocked } from "./runtime/receipt.ts";
it("real OAuth prerequisite", () => { throw new VerificationBlocked("Real local Google OAuth is absent."); });
`);
  await writeFile(join(scratch, "test/broken.control.ts"), `throw new Error("import-probe");\n`);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function runChild(phase: "discover" | "run", environment: NodeJS.ProcessEnv = {}, suite = "postgres") {
  const reportPath = join(scratch, `${phase}-report.json`);
  const outcome = await withOwnedCommands({ graceMs: 1_000 }, (commands) => commands.execute({
    command: process.execPath,
    args: ["--experimental-strip-types", join(scratch, "test/runtime/vitest-child.ts"), phase, reportPath, suite],
    cwd: scratch, env: { ...process.env, ...environment },
    deadlineMs: 50_000, log: join(scratch, `${phase}.log`),
  }));
  const status = outcome.kind === "succeeded" ? 0 : outcome.kind === "failed" && outcome.exit.kind === "exited" ? outcome.exit.code : null;
  return { status, text: await readFile(reportPath, "utf8") };
}

const identities = ["passes", "fails", "skips", "todo", "group > leaks"].map((name) => `test/cases.control.ts > ${name}`);

describe("Vitest child entry", () => {
  it("reports a blocked prerequisite with nonzero exit and no fabricated pass", async () => {
    const { status, text } = await runChild("run", {}, "journeys");
    const report = decodeReport(text, "run");
    expect(status).toBe(1);
    expect(report).toMatchObject({ phase: "run", observed: [{
      identity: "test/blocked.control.ts > real OAuth prerequisite", result: "blocked",
      evidence: ["Real local Google OAuth is absent."],
    }] });
    expect(report.errors).toContain("Module test/blocked.control.ts ended failed.");
    expect(report.errors).toContain("Vitest ended failed.");
  }, 60_000);

  it("discovers skipped and todo cases and reports a module that cannot be imported", async () => {
    const { status, text } = await runChild("discover");
    const report = decodeReport(text, "discover");
    expect(status).toBe(1);
    expect(report.required).toEqual(identities);
    expect(report.errors).toContain("test/broken.control.ts: import-probe");
  }, 60_000);

  it("keeps each actual outcome and every run error and redacts the database before publishing", async () => {
    const databaseUrl = "postgres://probe:pw-secret-probe@127.0.0.1:9/probe";
    const { status, text } = await runChild("run", { TEST_DATABASE_URL: databaseUrl, TOWER_HEARTBEAT_TOKEN: "private-heartbeat", TOOLS_S3_SECRET_ACCESS_KEY: "private-storage" });
    const report = decodeReport(text, "run");
    expect(status).toBe(1);
    expect(report.observed.map(({ identity, result }) => [identity, result])).toEqual([
      [identities[0], "passed"],
      [identities[1], "failed"],
      [identities[2], "skipped"],
      [identities[3], "skipped"],
      [identities[4], "passed"],
    ]);
    expect(report.observed[1]?.evidence.join(" ")).toContain("postgres://probe:[redacted]");
    expect(report.errors).toEqual(expect.arrayContaining([
      "unhandled-probe",
      "test/broken.control.ts: import-probe",
      "test/cases.control.ts: afterAll-probe",
      "test/cases.control.ts: suite-afterAll-probe",
    ]));
    expect(text).not.toContain("pw-secret-probe");
    expect(text).not.toContain("private-heartbeat");
    expect(text).not.toContain("private-storage");
  }, 60_000);
});
