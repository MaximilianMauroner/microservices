import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";

const WAKE_WINDOW_MS = 30_000;
const STARTING_UP = "57P03";

type Target = { host: string; port: number; user: string; database: string };

/** Railway sleeps Postgres between traffic. While it wakes, connections are
 * refused, time out, or get 57P03, and postgres.js fails the waiting query.
 * Each new connection therefore waits until a probe gets past startup. */
export function connectPostgres(url: string, options: postgres.Options<{}> = {}) {
  const socket = ({ host, port, user, database }: { host: string[]; port: number[]; user: string; database: string }) =>
    connectWhenReady({ host: host[0]!, port: port[0]!, user, database });
  return postgres(url, { ...options, socket } as postgres.Options<{}>);
}

export async function connectWhenReady(target: Target, windowMs = WAKE_WINDOW_MS) {
  const deadline = Date.now() + windowMs;
  for (let wait = 250; ; wait = Math.min(wait * 2, 2_000)) {
    try {
      await probe(target, deadline - Date.now());
      return await open(target, deadline - Date.now());
    } catch (error) {
      if (Date.now() + wait >= deadline) throw error;
      await delay(wait);
    }
  }
}

function open({ host, port }: Target, timeoutMs: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs, () => socket.destroy(connectTimeout()));
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.setTimeout(0);
      socket.off("error", reject);
      resolve(socket);
    });
  });
}

/** Sends a StartupMessage and reads the first reply. An authentication request
 * means Postgres accepts connections. Other errors belong to postgres.js. */
async function probe(target: Target, timeoutMs: number) {
  const socket = await open(target, timeoutMs);
  try {
    const reply = await new Promise<Buffer>((resolve, reject) => {
      let received = Buffer.alloc(0);
      socket.setTimeout(timeoutMs, () => socket.destroy(connectTimeout()));
      socket.once("error", reject);
      socket.once("close", () => reject(Object.assign(new Error("Postgres closed the connection during startup"), { code: "ECONNRESET" })));
      socket.on("data", chunk => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= 5 && received.length >= 1 + received.readInt32BE(1)) resolve(received);
      });
      socket.write(startupMessage(target));
    });
    if (reply[0] === 0x45 && errorCode(reply) === STARTING_UP) {
      throw Object.assign(new Error("the database system is starting up"), { code: STARTING_UP });
    }
  } finally {
    socket.destroy();
  }
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

function connectTimeout() {
  return Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
}
