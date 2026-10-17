import { setTimeout as delay } from "node:timers/promises";
import { withOwnedCommands } from "./commands.ts";
import { withLocalStack } from "./local-stack.ts";

const directory = process.argv[2];
const seconds = Number(process.argv[3] ?? "1800");
if (!directory || process.argv.length > 4 || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) {
  console.error("Usage: pnpm local:stack /absolute/private/run-directory [lifetime-seconds 1..3600]");
  process.exitCode = 2;
} else {
  const stop = new AbortController();
  const force = new AbortController();
  let interrupted: "SIGINT" | "SIGTERM" | undefined;
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    if (interrupted) force.abort();
    else { interrupted = signal; stop.abort({ kind: "interrupted", signal }); }
  };
  const sigint = () => interrupt("SIGINT");
  const sigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  try {
    const result = await withOwnedCommands({ graceMs: 2_000, force: force.signal }, (cleanup) =>
      withOwnedCommands({ graceMs: 2_000, force: force.signal }, (work) => withLocalStack({
        directory, commands: { work, cleanup }, environment: process.env, signal: stop.signal, lifetimeMs: seconds * 1000,
      }, async ({ manifest, signal, expiresAt }) => {
        process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
        await delay(Math.max(1, expiresAt - Date.now() - 1000), undefined, { signal }).catch(() => {});
      })));
    process.stdout.write(JSON.stringify({ kind: result.kind, reason: result.reason, cleanup: result.cleanup }) + "\n");
    process.exitCode = interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : result.kind === "completed" ? 0 : result.kind === "blocked" ? 2 : 1;
  } finally {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
  }
}
