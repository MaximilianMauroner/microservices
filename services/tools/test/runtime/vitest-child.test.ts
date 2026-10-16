import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeReport } from "./receipt.ts";

const tools = fileURLToPath(new URL("../../", import.meta.url));
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "runtime-vitest-child-"));
  await mkdir(join(scratch, "test/runtime"), { recursive: true });
  for (const file of ["vitest-child.ts", "receipt.ts"]) await copyFile(join(tools, "test/runtime", file), join(scratch, "test/runtime", file));
  await symlink(join(tools, "node_modules"), join(scratch, "node_modules"));
  await writeFile(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(scratch, "vitest.postgres.config.ts"), `export default { test: { include: ["test/*.control.ts"], maxWorkers: 1, fileParallelism: false, retry: 0 } };\n`);
  await writeFile(join(scratch, "test/cases.control.ts"), `import { afterAll, describe, expect, it } from "vitest";
it("passes", () => {});
it("fails", () => { expect(process.env.TEST_DATABASE_URL).toBe("another database"); });
it.skip("skips", () => {});
it.todo("todo");
describe("group", () => {
  it("leaks", async () => { void Promise.reject(new Error("unhandled-probe")); await new Promise((resolve) => setTimeout(resolve, 50)); });
  afterAll(() => { throw new Error("suite-afterAll-probe"); });
});
afterAll(() => { throw new Error("afterAll-probe"); });
`);
  await writeFile(join(scratch, "test/broken.control.ts"), `throw new Error("import-probe");\n`);
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function runChild(phase: "discover" | "run", environment: NodeJS.ProcessEnv = {}) {
  const reportPath = join(scratch, `${phase}-report.json`);
  const child = spawnSync(process.execPath, ["--experimental-strip-types", join(scratch, "test/runtime/vitest-child.ts"), phase, reportPath], {
    cwd: scratch,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: child.status, text: await readFile(reportPath, "utf8") };
}

const identities = ["passes", "fails", "skips", "todo", "group > leaks"].map((name) => `test/cases.control.ts > ${name}`);

describe("Vitest child entry", () => {
  it("discovers skipped and todo cases and reports a module that cannot be imported", async () => {
    const { status, text } = await runChild("discover");
    const report = decodeReport(text, "discover");
    expect(status).toBe(1);
    expect(report.required).toEqual(identities);
    expect(report.errors).toContain("test/broken.control.ts: import-probe");
  }, 60_000);

  it("keeps each actual outcome and every run error and redacts the database before publishing", async () => {
    const databaseUrl = "postgres://probe:pw-secret-probe@127.0.0.1:9/probe";
    const { status, text } = await runChild("run", { TEST_DATABASE_URL: databaseUrl });
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
  }, 60_000);
});
