import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createPushHandoff, type PushMode } from "./postgres-push-guard.js";

export async function runSchemaPush(config: string, environment: NodeJS.ProcessEnv, mode: PushMode) {
  const handoff = createPushHandoff(environment, mode);
  try {
    const push = spawn("pnpm", ["exec", "drizzle-kit", "push", "--config", config], {
      cwd: new URL(".", import.meta.url),
      env: {
        ...environment,
        TOOLS_SCHEMA_PUSH_HANDOFF: handoff.path,
        TOOLS_SCHEMA_PUSH_NONCE: handoff.nonce,
        TOOLS_SCHEMA_PUSH_MODE: handoff.mode,
      },
      stdio: "inherit",
    });
    await new Promise<void>((resolve, reject) => {
      push.once("error", reject);
      push.once("exit", (code, signal) => {
        if (signal) reject(new Error(`Drizzle terminated by ${signal}.`));
        else if (code !== 0) reject(new Error(`Drizzle exited with code ${code ?? "unknown"}.`));
        else resolve();
      });
    });
  } catch (cause) {
    // CLI progress text cannot prove that no SQL mutation was submitted.
    throw new Error(
      `Schema push failed for ${config}. No automatic retry was attempted. ` +
      "Database changes may be incomplete; inspect the failed stage and database state before retrying. " +
      "Later schema pushes, runtime reconciliation, and publisher backfill must not run.",
      { cause },
    );
  } finally {
    await rm(handoff.directory, { recursive: true, force: true });
  }
}
