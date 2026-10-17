import { runVerification, type VerificationMode } from "./verification.ts";

const mode = process.argv[2] ?? "workspace";
if (!["workspace", "money-postgres"].includes(mode) || process.argv.length > 3) throw new Error("Usage: run.ts [workspace|money-postgres]");
await runVerification(mode as VerificationMode);
