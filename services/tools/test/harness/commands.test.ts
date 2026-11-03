import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withOwnedCommands, type CommandExecutor, type CommandSpec } from "./commands.ts";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "owned-command-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function node(code: string, overrides: Partial<CommandSpec> = {}): CommandSpec {
  return { command: process.execPath, args: ["-e", code], deadlineMs: 3_000, log: join(directory, "command.log"), ...overrides };
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const text = await readFile(path, "utf8").catch(() => undefined);
    if (text) return text;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Fixture did not become ready. ${path}`);
}

async function isAbsent(pid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await readFile(`/proc/${pid}/stat`); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

describe("owned command lifecycle", () => {
  it("keeps a deadline failure when TERM makes the target exit zero", async () => {
    const outcome = await withOwnedCommands({ graceMs: 100 }, (commands) => commands.execute(node(
      'process.on("SIGTERM", () => process.exit(0)); setTimeout(() => process.exit(9), 2000);', { deadlineMs: 250 },
    )));
    expect(outcome).toMatchObject({ kind: "failed", termination: { kind: "deadline" }, exit: { kind: "exited", code: 0 }, ownership: "released" });
  });

  it("sweeps an in-group descendant after the target exits naturally", async () => {
    const marker = join(directory, "descendant");
    const code = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
      const child=spawn(process.execPath,['-e','setTimeout(() => {}, 4000)'],{stdio:'inherit'});
      fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid)); console.log('finished'); process.exit(0);`;
    const outcome = await withOwnedCommands({ graceMs: 100 }, (commands) => commands.execute(node(code)));
    expect(outcome).toMatchObject({ kind: "succeeded", stdout: "finished\n" });
    expect(await isAbsent(Number(await readFile(marker, "utf8")))).toBe(true);
  });

  it("closes active commands when readiness or an assertion throws", async () => {
    const marker = join(directory, "ready");
    const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid)); process.on('SIGTERM',()=>{}); setTimeout(()=>{},4000);`;
    await expect(withOwnedCommands({ graceMs: 100 }, async (commands) => {
      void commands.execute(node(code));
      await waitForFile(marker);
      throw new Error("readiness failed");
    })).rejects.toThrow("readiness failed");
    expect(await isAbsent(Number(await readFile(marker, "utf8")))).toBe(true);
  });

  it("does not admit pre-aborted or already-due work", async () => {
    const marker = join(directory, "unexpected");
    const spec = node(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`);
    const controller = new AbortController();
    controller.abort({ kind: "interrupted", signal: "SIGTERM" });
    await withOwnedCommands({ graceMs: 100 }, async (commands) => {
      expect(await commands.execute({ ...spec, signal: controller.signal })).toEqual({ kind: "not-started", reason: "interrupted" });
      expect(await commands.execute({ ...spec, deadlineMs: 0 })).toEqual({ kind: "not-started", reason: "deadline" });
    });
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not admit a retained executor after its scope closes", async () => {
    let retained: CommandExecutor | undefined;
    await withOwnedCommands({ graceMs: 100 }, async (commands) => { retained = commands; });
    expect(await retained!.execute(node("process.exit(0)"))).toEqual({ kind: "not-started", reason: "scope-closed" });
  });

  it("fails when a command log cannot be published", async () => {
    const outcome = await withOwnedCommands({ graceMs: 100 }, (commands) => commands.execute(node("process.exit(0)", { log: join(directory, "missing", "log") })));
    expect(outcome).toMatchObject({ kind: "failed", log: { kind: "failed" } });
  });

  it("reports a missing executable as blocked", async () => {
    const outcome = await withOwnedCommands({ graceMs: 100 }, (commands) => commands.execute({ ...node(""), command: join(directory, "absent") }));
    expect(outcome).toMatchObject({ kind: "blocked", exit: { kind: "unavailable", reason: "ENOENT" } });
  });

  it("redacts command output before writing it", async () => {
    const outcome = await withOwnedCommands({ graceMs: 100 }, (commands) => commands.execute(node("console.log('private-password')", { redact: (text) => text.replaceAll("private-password", "[redacted]") })));
    expect(outcome).toMatchObject({ kind: "succeeded", stdout: "[redacted]\n" });
    expect(await readFile(join(directory, "command.log"), "utf8")).toBe("[redacted]\n");
  });
});
