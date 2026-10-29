import { describe, expect, it } from "vitest";
import type { CommandExecutor, CommandOutcome, CommandSpec } from "./commands.ts";
import { createOwnedPostgres } from "./postgres.ts";

function failed(kind: "failed" | "blocked" = "failed", reasons = ["test failure"]): CommandOutcome {
  return {
    kind, termination: { kind: "natural" }, exit: { kind: "exited", code: 1 }, escalation: "none",
    ownership: "released", log: { kind: "written", path: "/private/log" }, reasons,
  };
}

function fixtureCommands() {
  const work: CommandSpec[] = [];
  const cleanup: CommandSpec[] = [];
  let name = "";
  let respond: (spec: CommandSpec, action: string, cleaning: boolean) => CommandOutcome | undefined = () => undefined;
  function executor(effects: CommandSpec[], cleaning: boolean): CommandExecutor {
    return { async execute(spec) {
      effects.push(spec);
      const action = spec.command === "docker" ? spec.args[2]! : spec.args.at(-1)!;
      if (action === "run") name = spec.args[spec.args.indexOf("--name") + 1]!;
      const response = respond(spec, action, cleaning);
      if (response) return response;
      const stdout = action === "port" ? "127.0.0.1:54321\n"
        : action === "inspect" ? `${name}\n`
        : spec.command !== "docker" ? `${action}\n` : "";
      return { kind: "succeeded", stdout, log: spec.log };
    } };
  }
  return {
    work, cleanup, commands: { work: executor(work, false), cleanup: executor(cleanup, true) },
    respond(handler: typeof respond) { respond = handler; },
    destructive() { return [...work, ...cleanup].filter((spec) => spec.command === "docker" && ["stop", "rm"].includes(spec.args[2]!)); },
  };
}

async function ready(harness: ReturnType<typeof fixtureCommands>, signal?: AbortSignal) {
  const setup = await createOwnedPostgres({ PATH: "/usr/bin" }, harness.commands, "/private/run", signal);
  expect(setup.kind).toBe("ready");
  if (setup.kind !== "ready") throw new Error("Fixture setup did not pass.");
  return setup.fixture;
}

describe("owned PostgreSQL lifecycle", () => {
  it("checks both ownership proofs and performs cleanup once across concurrent and repeated close calls", async () => {
    const harness = fixtureCommands();
    const fixture = await ready(harness);
    const first = fixture.close();
    expect(fixture.close()).toBe(first);
    expect(await first).toEqual({ kind: "cleaned", name: fixture.name });
    expect(await fixture.close()).toEqual({ kind: "cleaned", name: fixture.name });
    expect(harness.cleanup.map((spec) => spec.command === "docker" ? spec.args[2] : spec.args.at(-1))).toEqual(["inspect", "verify", "stop", "rm"]);
    expect(harness.destructive().map((spec) => spec.args.slice(2))).toEqual([
      ["stop", "--time", "10", fixture.name], ["rm", fixture.name],
    ]);
    expect(harness.work.flatMap((spec) => spec.args)).not.toContain("--rm");
    expect(harness.cleanup.every((spec) => spec.signal === undefined)).toBe(true);
  });

  it("keeps cleanup usable when the work signal is cancelled after readiness", async () => {
    const harness = fixtureCommands();
    const controller = new AbortController();
    const fixture = await ready(harness, controller.signal);
    controller.abort();
    expect((await fixture.close()).kind).toBe("cleaned");
    expect(harness.work.every((spec) => spec.signal === controller.signal)).toBe(true);
    expect(harness.cleanup.every((spec) => spec.signal === undefined)).toBe(true);
  });

  it.each(["wrong-label", "extra-label", "unreadable-label", "missing-sentinel", "wrong-sentinel", "view-sentinel", "unreadable-sentinel", "invalid-result"])("retains the container for %s", async (defect) => {
    const harness = fixtureCommands();
    const fixture = await ready(harness);
    harness.respond((spec, action, cleaning) => {
      if (!cleaning) return;
      if (action === "inspect" && defect === "wrong-label") return { kind: "succeeded", stdout: "other-owner\n", log: spec.log };
      if (action === "inspect" && defect === "extra-label") return { kind: "succeeded", stdout: `${fixture.name}\nother-owner\n`, log: spec.log };
      if (action === "inspect" && defect === "unreadable-label") return failed();
      if (action === "verify" && defect === "invalid-result") return { kind: "succeeded", stdout: "", log: spec.log };
      if (action === "verify") return failed("failed", [defect]);
    });
    expect((await fixture.close()).kind).toBe("retained");
    expect(harness.destructive()).toEqual([]);
    if (defect.includes("label")) expect(harness.cleanup).toHaveLength(1);
  });

  it.each(["stop", "rm"])("reports a failed %s without repeating destructive effects", async (action) => {
    const harness = fixtureCommands();
    const fixture = await ready(harness);
    harness.respond((_spec, current, cleaning) => cleaning && current === action ? failed() : undefined);
    expect((await fixture.close()).kind).toBe("failed");
    const effects = harness.destructive().length;
    expect((await fixture.close()).kind).toBe("failed");
    expect(harness.destructive()).toHaveLength(effects);
    expect(effects).toBe(action === "stop" ? 1 : 2);
  });

  it.each(["run", "port", "ready", "initialize", "verify"])("retains every container whose setup fails during %s", async (action) => {
    const harness = fixtureCommands();
    harness.respond((_spec, current) => current === action ? failed() : undefined);
    const setup = await createOwnedPostgres({}, harness.commands, "/private/run");
    expect(setup).toMatchObject({ kind: "retained-unverified", name: expect.stringMatching(/^tools-runtime-/) });
    expect(harness.cleanup).toEqual([]);
    expect(harness.destructive()).toEqual([]);
  });

  it.each(["ready", "initialize", "verify"])("requires the query result for %s, even after command success", async (operation) => {
    const harness = fixtureCommands();
    harness.respond((spec, current) => current === operation ? { kind: "succeeded", stdout: "unexpected\n", log: spec.log } : undefined);
    expect((await createOwnedPostgres({}, harness.commands, "/private/run")).kind).toBe("retained-unverified");
    expect(harness.destructive()).toEqual([]);
  });

  it.each(["0.0.0.0:54321\n", "[::]:54321\n", "127.0.0.1:0\n", "127.0.0.1:65536\n", "127.0.0.1:54321\n127.0.0.1:54322\n"])("rejects an unverified published port %s", async (stdout) => {
    const harness = fixtureCommands();
    harness.respond((spec, action) => action === "port" ? { kind: "succeeded", stdout, log: spec.log } : undefined);
    expect((await createOwnedPostgres({}, harness.commands, "/private/run")).kind).toBe("retained-unverified");
    expect(harness.work.every((spec) => spec.command === "docker")).toBe(true);
    expect(harness.destructive()).toEqual([]);
  });

  it("refuses an inherited endpoint before admitting commands", async () => {
    const harness = fixtureCommands();
    const setup = await createOwnedPostgres({ DATABASE_URL: "private-endpoint" }, harness.commands, "/private/run");
    expect(setup.kind).toBe("blocked");
    expect(JSON.stringify(setup)).not.toContain("private-endpoint");
    expect(harness.work).toEqual([]);
  });

  it("does not admit commands for a pre-aborted setup", async () => {
    const harness = fixtureCommands();
    const controller = new AbortController();
    controller.abort();
    expect((await createOwnedPostgres({}, harness.commands, "/private/run", controller.signal)).kind).toBe("failed");
    expect(harness.work).toEqual([]);
  });

  it.each(["info", "run", "port", "ready", "initialize", "verify"])("stops setup admission after cancellation during %s", async (action) => {
    const harness = fixtureCommands();
    const controller = new AbortController();
    harness.respond((_spec, current) => { if (current === action) controller.abort(); return undefined; });
    const setup = await createOwnedPostgres({}, harness.commands, "/private/run", controller.signal);
    expect(setup.kind).toBe(action === "info" ? "failed" : "retained-unverified");
    expect(harness.work.at(-1)?.args.at(-1)).toBe(action === "info" ? "{{.ServerVersion}}" : action === "run" ? "postgres:16-alpine" : action === "port" ? "5432/tcp" : action);
    expect(harness.destructive()).toEqual([]);
  });

  it("reports an unavailable Docker prerequisite as blocked without creating a container", async () => {
    const harness = fixtureCommands();
    harness.respond(() => failed("blocked", ["ENOENT"]));
    expect((await createOwnedPostgres({}, harness.commands, "/private/run")).kind).toBe("blocked");
    expect(harness.work).toHaveLength(1);
  });

  it("reports a Docker daemon refusal as blocked", async () => {
    const harness = fixtureCommands();
    harness.respond(() => failed());
    expect((await createOwnedPostgres({}, harness.commands, "/private/run")).kind).toBe("blocked");
    expect(harness.work).toHaveLength(1);
  });

  it("does not claim a container was retained when creation was not started", async () => {
    const harness = fixtureCommands();
    harness.respond((_spec, action) => action === "run" ? { kind: "not-started", reason: "cancelled" } : undefined);
    expect((await createOwnedPostgres({}, harness.commands, "/private/run")).kind).toBe("failed");
    expect(harness.destructive()).toEqual([]);
  });

  it("keeps credentials in the child environment and redacts command diagnostics", async () => {
    const harness = fixtureCommands();
    const fixture = await ready(harness);
    const password = new URL(fixture.url).password;
    for (const spec of [...harness.work]) {
      expect(spec.args.join(" ")).not.toContain(password);
      expect(spec.redact?.(`${fixture.url} ${password}`)).not.toContain(password);
      if (spec.command !== "docker") expect(spec.env?.TOOLS_RUNTIME_POSTGRES_URL).toBe(fixture.url);
    }
    harness.respond((_spec, action, cleaning) => cleaning && action === "verify" ? failed("failed", [`private ${fixture.url} ${password}`]) : undefined);
    const result = await fixture.close();
    expect(JSON.stringify(result)).not.toContain(password);
    expect(harness.destructive()).toEqual([]);
  });

  it("converts executor exceptions to a structured retained outcome without leaking secrets", async () => {
    const harness = fixtureCommands();
    const fixture = await ready(harness);
    harness.respond(() => { throw new Error(fixture.url); });
    const result = await fixture.close();
    expect(result.kind).toBe("retained");
    expect(JSON.stringify(result)).not.toContain(new URL(fixture.url).password);
    expect(harness.destructive()).toEqual([]);
  });

  it("assigns finite caps and separate private logs to work and cleanup", async () => {
    const harness = fixtureCommands();
    const fixture = await ready(harness);
    await fixture.close();
    const effects = [...harness.work, ...harness.cleanup];
    expect(effects.every((spec) => Number.isFinite(spec.deadlineMs) && spec.deadlineMs > 0 && spec.deadlineMs <= 120_000)).toBe(true);
    expect(new Set(effects.map((spec) => spec.log)).size).toBe(effects.length);
    expect(effects.filter((spec) => spec.command === "docker").every((spec) => spec.args[0] === "--host" && spec.args[1] === "unix:///var/run/docker.sock")).toBe(true);
  });
});
