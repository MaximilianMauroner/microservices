import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";

const STARTING_UP = "57P03";

type Target = { host: string; port: number; user: string; database: string };
type SocketOptions = { host: string[]; port: number[]; user: string; database: string; connect_timeout: number };

/** Railway sleeps Postgres between traffic. While it wakes, connections are
 * refused, time out, or get 57P03, and postgres.js fails the waiting query.
 * Each new connection therefore waits up to connect_timeout for a probe to get
 * past startup, then connects the way postgres.js would. The factory never
 * rejects, so a failed connection still reaches postgres.js's close handling. */
export function connectPostgres(url: string, options: postgres.Options<{}> = {}) {
  const socket = async ({ host, port, user, database, connect_timeout }: SocketOptions) => {
    const target = { host: host[0]!, port: port[0]!, user, database };
    await waitUntilReady(target, connect_timeout * 1000).catch(() => undefined);
    return Object.assign(net.connect({ host: target.host, port: target.port }), { host: target.host, port: target.port });
  };
  return postgres(url, { ...options, socket } as postgres.Options<{}>);
}

export async function waitUntilReady(target: Target, windowMs: number) {
  const deadline = Date.now() + windowMs;
  for (let wait = 250; ; wait = Math.min(wait * 2, 2_000)) {
    try {
      return await probe(target, deadline);
    } catch (error) {
      if (Date.now() + wait >= deadline) throw error;
      await delay(wait);
    }
  }
}

/** Sends a StartupMessage and reads the first reply. An authentication request
 * means Postgres accepts connections. Other errors belong to postgres.js. */
function probe(target: Target, deadline: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port });
    const timer = setTimeout(() => socket.destroy(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })),
      Math.max(0, deadline - Date.now()));
    const settle = (error?: Error) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    let received = Buffer.alloc(0);
    socket.once("error", settle);
    socket.once("close", () => settle(Object.assign(new Error("Postgres closed the connection during startup"), { code: "ECONNRESET" })));
    socket.on("data", chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 5 || received.length < 1 + received.readInt32BE(1)) return;
      settle(received[0] === 0x45 && errorCode(received) === STARTING_UP
        ? Object.assign(new Error("the database system is starting up"), { code: STARTING_UP })
        : undefined);
    });
    socket.write(startupMessage(target));
  });
}

function startupMessage({ user, database }: Target) {
  const body = Buffer.from(`user\0${user}\0database\0${database}\0\0`);
  const header = Buffer.alloc(8);
  header.writeInt32BE(8 + body.length, 0);
  header.writeInt32BE(196608, 4);
  return Buffer.concat([header, body]);
}

function errorCode(reply: Buffer) {
  const fields = reply.subarray(5, 1 + reply.readInt32BE(1)).toString().split("\0");
  return fields.find(field => field.startsWith("C"))?.slice(1);
}
