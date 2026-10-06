import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runSchemaPush } from "../database/run-schema-push.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fakeDrizzle(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "tools-push-failure-test-"));
  directories.push(directory);
  const record = join(directory, "attempts.jsonl");
  await writeFile(join(directory, "pnpm"), `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.PUSH_TEST_RECORD, JSON.stringify({
  handoff: process.env.TOOLS_SCHEMA_PUSH_HANDOFF,
  args: process.argv.slice(2),
}) + "\\n");
${source}
`, { mode: 0o700 });
  const environment = {
    PATH: directory,
    PUSH_TEST_RECORD: record,
    DATABASE_URL: "postgres://test:test@localhost/disposable",
    TOOLS_ENVIRONMENT: "development",
    TOOLS_DEVELOPMENT_SCHEMA_PUSH_CONFIRM: "tools-platform-development",
  };
  return { environment, record, directory };
}

describe("schema push child failures", () => {
  it("stops the deployment script before the next schema or reconciliation", async () => {
    const { environment, record } = await fakeDrizzle('console.error("read ECONNRESET"); process.exit(1);');
    const result = await promisify(execFile)(process.execPath, [
      "--import", "tsx", "database/push-postgres.ts", "development",
    ], { cwd: new URL("..", import.meta.url), env: environment }).then(
      () => { throw new Error("Interrupted push unexpectedly succeeded."); },
      (error: { code: number; stderr: string }) => error,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Schema push failed for drizzle.tools.config.ts");
    expect(result.stderr).toContain("read ECONNRESET");
    const attempts = (await readFile(record, "utf8")).trim().split("\n");
    expect(attempts).toHaveLength(1);
    const attempt = JSON.parse(attempts[0]) as { handoff: string };
    await expect(stat(join(attempt.handoff, ".."))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["introspection connection reset", `
const net = require("node:net");
const server = net.createServer(socket => socket.once("data", () => socket.resetAndDestroy()));
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1", () => client.write("introspection"));
  client.on("error", error => { console.error(error.code); process.exit(1); });
});`],
    ["ambiguous partial mutation", 'fs.writeFileSync(process.env.PUSH_TEST_RECORD + ".mutation", "submitted"); console.error("read ECONNRESET"); process.exit(1);'],
    ["termination", 'process.kill(process.pid, "SIGTERM");'],
  ])("does not retry after %s and cleans the handoff", async (_label, source) => {
    const { environment, record } = await fakeDrizzle(source);
    await expect(runSchemaPush("drizzle.tools.config.ts", environment, "development"))
      .rejects.toThrow("No automatic retry was attempted");
    const attempts = (await readFile(record, "utf8")).trim().split("\n");
    expect(attempts).toHaveLength(1);
    const attempt = JSON.parse(attempts[0]) as { handoff: string };
    await expect(stat(join(attempt.handoff, ".."))).rejects.toMatchObject({ code: "ENOENT" });
    if (_label === "ambiguous partial mutation") {
      expect(await readFile(record + ".mutation", "utf8")).toBe("submitted");
    }
  });

  it("cleans a consumed handoff after success", async () => {
    const { environment, record } = await fakeDrizzle('fs.unlinkSync(process.env.TOOLS_SCHEMA_PUSH_HANDOFF);');
    await runSchemaPush("drizzle.artifacts.config.ts", environment, "development");
    const attempt = JSON.parse((await readFile(record, "utf8")).trim()) as { handoff: string; args: string[] };
    expect(attempt.args).toEqual(["exec", "drizzle-kit", "push", "--config", "drizzle.artifacts.config.ts"]);
    await expect(stat(join(attempt.handoff, ".."))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains the cause when the command cannot start", async () => {
    const { environment, directory } = await fakeDrizzle("");
    await rm(join(directory, "pnpm"));
    await expect(runSchemaPush("drizzle.tools.config.ts", environment, "development"))
      .rejects.toMatchObject({ cause: { code: "ENOENT" } });
  });
});
