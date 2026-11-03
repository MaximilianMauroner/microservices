"use strict";
const { spawn } = require("node:child_process");

const [lifetimeMs, graceMs] = process.argv.slice(2).map(Number);
let target;
let stopping = false;
let sweeping = false;
let graceTimer;

process.on("SIGTERM", () => {});
process.on("error", () => stop("channel-error", graceMs));

function send(message) {
  return new Promise((resolve) => {
    if (!process.connected) return resolve(false);
    const timer = setTimeout(resolve, 1_000, false);
    try {
      process.send(message, (error) => {
        clearTimeout(timer);
        resolve(!error);
      });
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

function sweep(reason) {
  if (sweeping) return;
  sweeping = true;
  clearTimeout(graceTimer);
  if (process.connected) {
    try {
      process.send({ type: "sweeping", reason }, () => {});
    } catch {}
  }
  // The live anchor owns this group until this syscall ends it.
  process.kill(0, "SIGKILL");
}

function stop(reason, grace) {
  if (sweeping) return;
  if (!target) return sweep(reason);
  if (stopping) {
    if (grace === 0) sweep("grace-shortened");
    return;
  }
  stopping = true;
  void send({ type: "escalated", reason });
  process.kill(0, "SIGTERM");
  graceTimer = setTimeout(() => sweep("grace-expired"), grace);
}

setTimeout(() => sweep("hard-cap"), lifetimeMs);
setTimeout(() => stop("owner-limit", graceMs), lifetimeMs - graceMs - 1_000);
process.on("disconnect", () => stop("owner-lost", graceMs));
process.on("message", (message) => {
  if (message?.type === "stop") return stop(message.reason, graceMs);
  if (message?.type === "stop-now") return stop("force", 0);
  if (message?.type !== "launch" || stopping || sweeping || target) return;
  try {
    target = spawn(message.command, message.args, {
      cwd: message.cwd, env: message.env, detached: false,
      stdio: ["ignore", "inherit", "inherit"],
    });
    target.once("error", async (error) => {
      await send({ type: "spawn-error", code: error.code, message: error.message });
      sweep("spawn-error");
    });
    target.once("exit", async (code, signal) => {
      await send({ type: "target-exit", code, signal });
      sweep(stopping ? "after-stop" : "natural-exit");
    });
  } catch (error) {
    void send({ type: "spawn-error", message: error.message }).then(() => sweep("spawn-error"));
  }
});
void send({ type: "ready" });
