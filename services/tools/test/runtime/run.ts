import { runVerification } from "./verification.ts";

const mode = process.argv[2] ?? "workspace";
if (mode !== "workspace" && mode !== "money-postgres") throw new Error(`Unknown verification mode ${mode}.`);
process.exitCode = (await runVerification(mode)).exitStatus;
