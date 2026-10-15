import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createOwnedPostgres } from "./postgres.ts";

it("retries the published TCP connection while socket-only readiness would pass", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-tcp-"));
  const controller = new AbortController();
  let attempts = 0;
  const server = createServer((socket) => {
    socket.once("data", (startup) => {
      expect(startup.toString()).toContain("tools_runtime");
      attempts += 1;
      const fields = Buffer.from("SFATAL\0C57P03\0Mdatabase is starting\0\0");
      const header = Buffer.alloc(5);
      header[0] = "E".charCodeAt(0);
      header.writeInt32BE(fields.length + 4, 1);
      socket.end(Buffer.concat([header, fields]));
      if (attempts === 2) controller.abort();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing owned TCP listener.");
  const trace = join(directory, "docker.jsonl");
  const executable = join(directory, "docker");
  try {
    await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(4);
fs.appendFileSync(process.env.RUNTIME_DOCKER_TRACE, JSON.stringify(args) + '\\n');
if (args[0] === 'port') console.log('127.0.0.1:${address.port}');
`);
    await chmod(executable, 0o700);
    const error = await createOwnedPostgres({ PATH: directory, RUNTIME_DOCKER_TRACE: trace }, controller.signal).catch((error: unknown) => error);
    expect(attempts).toBe(2);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("fixture setup failed");
    const commands = (await readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
    expect(commands.some(([command]) => command === "stop" || command === "rm")).toBe(false);
  } finally {
    controller.abort();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
