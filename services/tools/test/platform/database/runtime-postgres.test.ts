import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { connectWhenReady } from "../../../platform/database/runtime-postgres.js";

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

function errorResponse(code: string) {
  const body = Buffer.from(`SFATAL\0C${code}\0Mthe database system is starting up\0\0`);
  const header = Buffer.alloc(5);
  header.write("E", 0);
  header.writeInt32BE(4 + body.length, 1);
  return Buffer.concat([header, body]);
}

const authenticationRequest = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 3]);

async function freePort() {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise(resolve => server.close(resolve));
  return port;
}

describe("connectWhenReady", () => {
  it("waits through a refused port and a starting-up reply until Postgres accepts startup", async () => {
    const port = await freePort();
    const replies = [errorResponse("57P03"), authenticationRequest];
    const startups: number[] = [];
    setTimeout(() => {
      const server = net.createServer(socket => {
        socket.once("data", () => {
          startups.push(Date.now());
          const reply = replies.shift();
          if (reply) socket.end(reply);
        });
      });
      servers.push(server);
      server.listen(port, "127.0.0.1");
    }, 400);

    const socket = await connectWhenReady({ host: "127.0.0.1", port, user: "tools", database: "railway" }, 10_000);

    expect(socket.readyState).toBe("open");
    expect(startups).toHaveLength(2);
    socket.destroy();
  });

  it("fails once the wake window passes without Postgres", async () => {
    const port = await freePort();
    await expect(connectWhenReady({ host: "127.0.0.1", port, user: "tools", database: "railway" }, 600))
      .rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});
