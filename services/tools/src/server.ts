import { defaultStreamHandler, createStartHandler } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import "./markdown-share-config.server.js";
import { closePlatformRuntime } from "./runtime-access.js";

const fetch = createStartHandler({ handler: defaultStreamHandler });

export default createServerEntry({ fetch });

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: "platform.stopping", signal }));
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  try {
    await closePlatformRuntime();
    process.exitCode = 0;
  } finally {
    clearTimeout(force);
  }
}
