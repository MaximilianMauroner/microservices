import { rm } from "node:fs/promises";
import { createSQLitePushHandoff } from "./sqlite-push-guard.js";

const handoff = createSQLitePushHandoff(process.env);
const push = Bun.spawn(["bun", "x", "drizzle-kit", "push", "--config", "drizzle.config.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    FIELD_GUIDE_SQLITE_PUSH_HANDOFF: handoff.path,
    FIELD_GUIDE_SQLITE_PUSH_NONCE: handoff.nonce,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await push.exited;
await rm(handoff.directory, { recursive: true, force: true });
process.exit(exitCode);
