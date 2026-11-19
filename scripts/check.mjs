import { spawn } from "node:child_process";

const results = await Promise.all(["typecheck", "test"].map((script) => new Promise((resolve) => {
  const child = spawn("pnpm", ["run", script], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.once("error", (error) => {
    console.error(error.message);
    resolve(1);
  });
  child.once("exit", (code) => resolve(code ?? 1));
})));

process.exitCode = results.find((code) => code !== 0) ?? 0;
