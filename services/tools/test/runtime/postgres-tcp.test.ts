import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { withOwnedCommands, type CommandExecutor, type CommandOutcome, type CommandSpec } from "./commands.ts";
import { createOwnedPostgres } from "./postgres.ts";

async function withTcpFixture(use: (fixture: {
  port: number;
  sockets: Set<Socket>;
  onStartup: (startup: Buffer, socket: Socket) => void;
  directory: string;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "runtime-postgres-tcp-"));
  const sockets = new Set<Socket>();
  const fixture = { port: 0, sockets, onStartup: (_startup: Buffer, _socket: Socket) => {}, directory };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setTimeout(8_000, () => socket.destroy());
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", (startup) => fixture.onStartup(startup, socket));
  });
  const hardLimit = setTimeout(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  }, 10_000);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing owned TCP listener.");
    fixture.port = address.port;
    await use(fixture);
  } finally {
    clearTimeout(hardLimit);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

function fakeDocker(port: number, owned: CommandExecutor, effects: CommandSpec[], results: CommandOutcome[], deadlineMs = 5_000): CommandExecutor {
  return { async execute(spec) {
    effects.push(spec);
    if (spec.command === "docker") return {
      kind: "succeeded", stdout: spec.args[2] === "port" ? `127.0.0.1:${port}\n` : "", log: spec.log,
    };
    const outcome = await owned.execute({ ...spec, deadlineMs });
    results.push(outcome);
    return outcome;
  } };
}

it("uses the published TCP endpoint and retries while PostgreSQL reports startup", async () => {
  await withTcpFixture(async (fixture) => {
    const controller = new AbortController();
    let attempts = 0;
    const startups: string[] = [];
    fixture.onStartup = (startup, socket) => {
      startups.push(startup.toString());
      attempts += 1;
      const fields = Buffer.from("SFATAL\0C57P03\0Mdatabase is starting\0\0");
      const header = Buffer.alloc(5);
      header[0] = "E".charCodeAt(0);
      header.writeInt32BE(fields.length + 4, 1);
      socket.end(Buffer.concat([header, fields]));
      if (attempts === 2) controller.abort();
    };
    await withOwnedCommands({ graceMs: 50 }, async (owned) => {
      const effects: CommandSpec[] = [];
      const results: CommandOutcome[] = [];
      const work = fakeDocker(fixture.port, owned, effects, results);
      const setup = await createOwnedPostgres({ PATH: process.env.PATH }, { work, cleanup: work }, fixture.directory, controller.signal);
      expect(setup.kind).toBe("retained-unverified");
      expect(attempts).toBe(2);
      expect(startups.every((startup) => startup.includes("tools_runtime"))).toBe(true);
      expect(effects.filter((spec) => spec.command !== "docker")).toHaveLength(1);
      expect(effects.some((spec) => ["stop", "rm"].includes(spec.args[2]!))).toBe(false);
    });
  });
}, 15_000);

it("ends live query I/O when its command reaches its deadline", async () => {
  await withTcpFixture(async (fixture) => {
    let attempts = 0;
    let connectionClosed: Promise<void> | undefined;
    fixture.onStartup = (_startup, socket) => {
      attempts += 1;
      connectionClosed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    };
    await withOwnedCommands({ graceMs: 50 }, async (owned) => {
      const effects: CommandSpec[] = [];
      const results: CommandOutcome[] = [];
      const work = fakeDocker(fixture.port, owned, effects, results, 2_000);
      const setup = await createOwnedPostgres({ PATH: process.env.PATH }, { work, cleanup: work }, fixture.directory);
      expect(setup.kind).toBe("retained-unverified");
      expect(attempts).toBeGreaterThan(0);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ kind: "failed", termination: { kind: "deadline" }, ownership: "released" });
      if (!connectionClosed) throw new Error("No TCP query was observed.");
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          connectionClosed,
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Query socket remained live after command completion.")), 1_000); }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      expect(fixture.sockets.size).toBe(0);
      expect(effects.some((spec) => ["stop", "rm"].includes(spec.args[2]!))).toBe(false);
    });
  });
}, 15_000);
