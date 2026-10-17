import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CommandExecutor, CommandOutcome, CommandSpec, ExitObservation, LogState, StopSignal, Termination } from "./command-types.ts";

export type { CommandExecutor, CommandOutcome, CommandSpec } from "./command-types.ts";

type Owner = Readonly<{ graceMs: number; lifetimeMs?: number; force?: AbortSignal }>;
const anchorPath = fileURLToPath(new URL("./command-anchor.cjs", import.meta.url));

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<undefined>((resolve) => (timer = setTimeout(resolve, ms, undefined)))]);
  } finally {
    clearTimeout(timer);
  }
}

function stopCause(signal: AbortSignal): Termination {
  const reason = signal.reason as { kind?: string; signal?: StopSignal } | undefined;
  return reason?.kind === "interrupted" && (reason.signal === "SIGINT" || reason.signal === "SIGTERM")
    ? { kind: "interrupted", signal: reason.signal }
    : { kind: "owner", reason: "cancelled" };
}

export async function withOwnedCommands<T>(owner: Owner, use: (commands: CommandExecutor) => Promise<T>): Promise<T> {
  const scope = new AbortController();
  const active = new Set<Promise<CommandOutcome>>();
  const commands: CommandExecutor = {
    execute(spec) {
      const pending = executeOwned(owner, spec, scope.signal);
      active.add(pending);
      const forget = () => active.delete(pending);
      pending.then(forget, forget);
      return pending;
    },
  };
  try {
    return await use(commands);
  } finally {
    scope.abort();
    await Promise.allSettled([...active]);
  }
}

async function executeOwned(owner: Owner, spec: CommandSpec, scope: AbortSignal): Promise<CommandOutcome> {
  if (scope.aborted) return { kind: "not-started", reason: "scope-closed" };
  if (spec.signal?.aborted) return { kind: "not-started", reason: stopCause(spec.signal).kind === "interrupted" ? "interrupted" : "cancelled" };
  if (!Number.isFinite(spec.deadlineMs) || spec.deadlineMs <= 0) return { kind: "not-started", reason: "deadline" };

  const lifetimeMs = owner.lifetimeMs ?? spec.deadlineMs + owner.graceMs + 5_000;
  const anchor = spawn(process.execPath, [anchorPath, String(lifetimeMs), String(owner.graceMs)], {
    detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const output: Buffer[] = [];
  anchor.stdout!.on("data", (chunk: Buffer) => output.push(chunk));
  anchor.stderr!.on("data", (chunk: Buffer) => output.push(chunk));
  const reasons: string[] = [];
  const anchorEnd = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    anchor.once("exit", (code, signal) => resolve({ code, signal }));
    anchor.once("error", () => { if (anchor.pid === undefined) resolve({ code: null, signal: null }); });
  });
  anchor.on("error", (error) => reasons.push(`Anchor error. ${error.message}`));
  const closed = (stream: NodeJS.ReadableStream) => new Promise<void>((resolve) => stream.once("close", () => resolve()));
  const released = Promise.all([closed(anchor.stdout!), closed(anchor.stderr!), new Promise<void>((resolve) => anchor.once("disconnect", resolve))]);
  let ready = false;
  let launched = false;
  let termination: Termination | undefined;
  let escalation: "none" | "term" | "kill" = "none";
  let exit: ExitObservation | undefined;
  let sweep: string | undefined;
  let spawnError: string | undefined;
  let deadline: NodeJS.Timeout | undefined;
  let signalReady: (value: boolean) => void = () => {};
  const readySeen = new Promise<boolean>((resolve) => (signalReady = resolve));
  void anchorEnd.then(() => signalReady(false));

  anchor.on("message", (value: unknown) => {
    if (!value || typeof value !== "object" || !("type" in value)) {
      reasons.push("Invalid anchor message.");
      return;
    }
    switch (value.type) {
      case "ready":
        ready = true;
        return signalReady(true);
      case "target-exit":
        if (!("code" in value) || !("signal" in value) || !((typeof value.code === "number" && value.signal === null) || (value.code === null && typeof value.signal === "string"))) {
          reasons.push("Invalid target exit.");
          return;
        }
        if (exit) reasons.push("Duplicate target exit.");
        clearTimeout(deadline);
        exit = typeof value.signal === "string" ? { kind: "signalled", signal: value.signal } : { kind: "exited", code: value.code as number };
        return;
      case "escalated":
        escalation = "term";
        if (!termination && "reason" in value && value.reason === "owner-limit") termination = { kind: "owner", reason: "owner-limit" };
        return;
      case "sweeping":
        if (!("reason" in value) || typeof value.reason !== "string") return reasons.push("Invalid sweep reason.");
        sweep = value.reason;
        if (["grace-expired", "grace-shortened", "hard-cap"].includes(sweep)) escalation = "kill";
        return;
      case "spawn-error":
        spawnError = "code" in value && typeof value.code === "string" ? value.code : "spawn failed";
        return;
      default:
        reasons.push("Unknown anchor message.");
    }
  });

  const control = (message: Readonly<Record<string, unknown>>) => {
    if (!anchor.connected) return;
    try {
      anchor.send(message, (error) => { if (error) reasons.push(`Anchor control failed. ${error.message}`); });
    } catch (error) {
      reasons.push(`Anchor control failed. ${(error as Error).message}`);
    }
  };
  const release = () => { if (anchor.connected) anchor.disconnect(); };
  const requestStop = (cause: Termination) => {
    if (termination || exit) return;
    termination = cause;
    if (launched) control({ type: "stop", reason: cause.kind });
    else release();
  };
  const onWorkAbort = () => requestStop(stopCause(spec.signal!));
  const onScopeAbort = () => requestStop({ kind: "owner", reason: "scope-closed" });
  const onForce = () => control({ type: "stop-now" });
  spec.signal?.addEventListener("abort", onWorkAbort);
  scope.addEventListener("abort", onScopeAbort);
  owner.force?.addEventListener("abort", onForce);

  let ended: { code: number | null; signal: string | null } | undefined;
  let drained = false;
  const startup = setTimeout(() => {
    if (ready) return;
    reasons.push("Anchor startup bound exceeded.");
    requestStop({ kind: "owner", reason: "anchor-failed" });
    signalReady(false);
  }, 2_000);
  try {
    await readySeen;
    clearTimeout(startup);
    if (ready && !termination && !scope.aborted && !spec.signal?.aborted && anchor.connected) {
      launched = true;
      control({ type: "launch", command: spec.command, args: spec.args, cwd: spec.cwd, env: spec.env ?? process.env });
      deadline = setTimeout(() => requestStop({ kind: "deadline", limitMs: spec.deadlineMs }), spec.deadlineMs);
    } else {
      termination ??= { kind: "owner", reason: "anchor-failed" };
      release();
    }
    ended = await bounded(anchorEnd, lifetimeMs + 1_000);
    if (!ended) {
      reasons.push("Anchor did not end within its cap.");
      release();
    }
    drained = (await bounded(released.then(() => true), 1_000)) ?? false;
    if (!drained) {
      anchor.stdout!.destroy();
      anchor.stderr!.destroy();
      release();
    }
  } finally {
    clearTimeout(startup);
    clearTimeout(deadline);
    spec.signal?.removeEventListener("abort", onWorkAbort);
    scope.removeEventListener("abort", onScopeAbort);
    owner.force?.removeEventListener("abort", onForce);
  }

  const redact = spec.redact ?? ((text: string) => text);
  const stdout = redact(Buffer.concat(output).toString("utf8"));
  let log: LogState;
  try {
    await writeFile(spec.log, stdout, { mode: 0o600 });
    log = { kind: "written", path: spec.log };
  } catch (error) {
    log = { kind: "failed", path: spec.log, reason: redact((error as Error).message) };
  }
  if (!ended || ended.signal !== "SIGKILL" || sweep === undefined) reasons.push("Anchor ended without its owned sweep.");
  const ownership = drained && ended?.signal === "SIGKILL" && sweep !== undefined ? "released" : "uncertain";
  const cause: Termination = termination ?? { kind: "natural" };
  if (launched && cause.kind === "natural" && exit?.kind === "exited" && exit.code === 0 && ownership === "released" && log.kind === "written" && !reasons.length) {
    return { kind: "succeeded", stdout, log: log.path };
  }
  return {
    kind: spawnError === "ENOENT" ? "blocked" : "failed",
    termination: cause,
    exit: exit ?? { kind: "unavailable", reason: spawnError ?? "Target ended in the group sweep." },
    escalation, ownership, log,
    reasons: [...reasons, ...(spawnError ? [spawnError] : [])].map(redact),
  };
}
