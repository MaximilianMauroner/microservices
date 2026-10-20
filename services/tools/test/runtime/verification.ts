import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withOwnedCommands, type CommandExecutor, type CommandOutcome, type CommandSpec } from "./commands.ts";
import { createOwnedPostgres, rejectInheritedDataEndpoints } from "./postgres.ts";
import { withVerificationStack, type LocalStackManifest } from "./local-stack.ts";
import { decodeReport, redactDatabase, requiredCaseReceipt, VerificationBlocked, type ChildReport } from "./receipt.ts";
import type { StopSignal } from "./command-types.ts";

export type VerificationMode = "workspace" | "money-postgres";
type Requirement =
  | Readonly<{ kind: "prerequisites" | "discover" | "fixture" | "schema" | "contracts" | "identity-discover" | "identity-contracts" | "cleanup" }>
  | Readonly<{ kind: "workspace-command"; command: "typecheck" | "test" | "build" }>;
type StepResult =
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "passed"; evidence: readonly string[] }>
  | Readonly<{ kind: "failed" | "blocked" | "not-run"; reasons: readonly string[]; evidence: readonly string[]; command?: CommandOutcome }>;
type Cell = { readonly requirement: Requirement; result: StepResult };
type Interruption = Readonly<{ kind: "none" }> | Readonly<{ kind: "received"; first: StopSignal }>;
type Decision = Readonly<{ kind: "passed" }> | Readonly<{ kind: "failed" | "blocked"; reasons: readonly string[] }> | Readonly<{ kind: "interrupted"; first: StopSignal }>;
type RunRecord = Readonly<{
  mode: VerificationMode;
  revision: string;
  fixture: string;
  cells: readonly Readonly<Cell>[];
  required: readonly string[];
  contracts: ReturnType<typeof requiredCaseReceipt> | undefined;
  identity: Readonly<{ required: readonly string[]; contracts?: ReturnType<typeof requiredCaseReceipt>; fixture?: LocalStackManifest }>;
  interruption: Interruption;
  decision: Decision;
}>;
type Completion = Readonly<{ kind: "published"; path: string }> | Readonly<{ kind: "unpublished"; stage: string }>;
const toolsRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = resolve(toolsRoot, "../..");
const vitestChild = fileURLToPath(new URL("./vitest-child.ts", import.meta.url));
const interruptedExit = { SIGINT: 130, SIGTERM: 143 } as const;

function planFor(mode: VerificationMode): Cell[] {
  const workspace: Requirement[] = mode === "workspace"
    ? (["typecheck", "test", "build"] as const).map((command) => ({ kind: "workspace-command", command })) : [];
  const identity: Requirement[] = mode === "workspace" ? [{ kind: "identity-discover" }, { kind: "identity-contracts" }] : [];
  const requirements: Requirement[] = [{ kind: "prerequisites" }, { kind: "discover" }, { kind: "fixture" }, ...workspace, { kind: "schema" }, { kind: "contracts" }, ...identity, { kind: "cleanup" }];
  return requirements.map((requirement) => ({ requirement, result: { kind: "pending" } }));
}

function label(requirement: Requirement) {
  return requirement.kind === "workspace-command" ? requirement.command : requirement.kind;
}

function commandResult(outcome: CommandOutcome): StepResult {
  switch (outcome.kind) {
    case "succeeded": return { kind: "passed", evidence: [outcome.log] };
    case "not-started": return { kind: "not-run", reasons: [`Command not started. ${outcome.reason}`], evidence: [] };
    case "failed":
    case "blocked": return {
      kind: outcome.kind, command: outcome,
      reasons: [`Command ${outcome.kind}. ${outcome.termination.kind}`, ...outcome.reasons],
      evidence: [outcome.log.path],
    };
  }
}

function decide(cells: readonly Cell[], interruption: Interruption): Decision {
  if (interruption.kind === "received") return { kind: "interrupted", first: interruption.first };
  const reasons = cells.filter((cell) => cell.result.kind !== "passed").map((cell) => `${label(cell.requirement)} ${cell.result.kind}`);
  if (!cells.length) reasons.push("Empty verification plan.");
  if (!reasons.length) return { kind: "passed" };
  return { kind: cells.some((cell) => cell.result.kind === "blocked") ? "blocked" : "failed", reasons };
}

async function childReport<Phase extends ChildReport["phase"]>(phase: Phase, commands: CommandExecutor, directory: string, env: NodeJS.ProcessEnv, signal: AbortSignal, redact: (text: string) => string, suite: "postgres" | "identity" = "postgres") {
  const name = suite === "identity" ? `identity-${phase}` : phase;
  const path = join(directory, `${name}-report.json`);
  const outcome = await commands.execute({
    command: process.execPath, args: ["--experimental-strip-types", vitestChild, phase, path, suite],
    cwd: toolsRoot, env, signal, redact, deadlineMs: phase === "discover" ? 120_000 : 600_000,
    log: join(directory, `${name}.log`),
  });
  try {
    const report = decodeReport(await readFile(path, "utf8"), phase);
    return { outcome, report, errors: report.errors };
  } catch (error) {
    return { outcome, report: undefined, errors: [redact((error as Error).message)] };
  }
}

export async function runVerification(mode: VerificationMode, paths?: Readonly<{ artifactParent: string }>): Promise<never> {
  let interruption: Interruption = { kind: "none" };
  let sealed = false;
  const work = new AbortController();
  const force = new AbortController();
  const onSignal = (signal: StopSignal) => {
    if (sealed) return;
    if (interruption.kind === "none") {
      interruption = { kind: "received", first: signal };
      work.abort({ kind: "interrupted", signal });
    } else force.abort();
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  const cells = planFor(mode);
  const directory = join(paths?.artifactParent ?? join(root, ".agents/artifacts/verify"), `runtime-${randomUUID()}`);
  let revision = "unknown";
  let required: readonly string[] = [];
  let contracts: ReturnType<typeof requiredCaseReceipt> | undefined;
  let identityRequired: readonly string[] = [];
  let identityContracts: ReturnType<typeof requiredCaseReceipt> | undefined;
  let identityFixture: LocalStackManifest | undefined;
  let fixture: Extract<Awaited<ReturnType<typeof createOwnedPostgres>>, { kind: "ready" }>["fixture"] | undefined;
  let fixtureState = "none";
  let failure: { stage: string; reason: string } | undefined;
  let current = cells[0]!;
  const redact = (text: string) => redactDatabase(text, fixture?.url);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await withOwnedCommands({ graceMs: 5_000, force: force.signal }, async (commands) => {
      await withOwnedCommands({ graceMs: 5_000 }, async (cleanupCommands) => {
        try {
          for (const cell of cells) {
            current = cell;
            const { requirement } = cell;
            if (requirement.kind === "cleanup") continue;
            if (work.signal.aborted || cells.some((other) => other.result.kind === "failed" || other.result.kind === "blocked" || other.result.kind === "not-run")) {
              cell.result = { kind: "not-run", reasons: [work.signal.aborted ? "Interrupted before admission." : "Earlier step did not pass."], evidence: [] };
              continue;
            }
            const spec = (command: string, args: readonly string[], name: string, deadlineMs: number, env = process.env, cwd = root): CommandSpec => ({
              command, args, cwd, env, deadlineMs, signal: work.signal, redact, log: join(directory, `${name}.log`),
            });
            switch (requirement.kind) {
              case "prerequisites": {
                rejectInheritedDataEndpoints(process.env);
                const head = await commands.execute(spec("git", ["rev-parse", "HEAD"], "revision", 10_000));
                cell.result = commandResult(head);
                if (head.kind !== "succeeded") break;
                revision = head.stdout.trim();
                const status = await commands.execute(spec("git", ["status", "--porcelain"], "worktree", 10_000));
                cell.result = commandResult(status);
                if (status.kind === "succeeded" && status.stdout.trim()) revision += "+dirty";
                break;
              }
              case "discover":
              case "identity-discover": {
                const suite = requirement.kind === "identity-discover" ? "identity" : "postgres";
                const discovery = await childReport("discover", commands, directory, process.env, work.signal, redact, suite);
                cell.result = commandResult(discovery.outcome);
                if (discovery.outcome.kind !== "succeeded") break;
                const found = discovery.report?.required ?? [];
                if (discovery.errors.length || !found.length || found.some((identity) => !identity.trim()) || new Set(found).size !== found.length) {
                  cell.result = { kind: "failed", reasons: ["Required discovery is empty, duplicated, or invalid.", ...discovery.errors], evidence: [join(directory, suite === "identity" ? "identity-discover-report.json" : "discover-report.json")] };
                  break;
                }
                if (suite === "identity") identityRequired = found;
                else required = found;
                await writeFile(join(directory, suite === "identity" ? "identity-required.json" : "required.json"), JSON.stringify(found, null, 2), { mode: 0o600 });
                break;
              }
              case "fixture": {
                const setup = await createOwnedPostgres(process.env, { work: commands, cleanup: cleanupCommands }, directory, work.signal);
                if (setup.kind === "ready") {
                  fixture = setup.fixture;
                  fixtureState = fixture.name;
                  cell.result = { kind: "passed", evidence: [fixture.name] };
                } else {
                  if (setup.kind === "retained-unverified") fixtureState = setup.name;
                  cell.result = { kind: setup.kind === "blocked" ? "blocked" : "failed", reasons: [setup.reason], evidence: [fixtureState] };
                }
                break;
              }
              case "workspace-command":
                cell.result = commandResult(await commands.execute(spec("pnpm", ["run", requirement.command], requirement.command, 600_000)));
                break;
              case "schema": {
                if (!fixture) throw new Error("No verified PostgreSQL fixture.");
                const env = { ...process.env, TEST_DATABASE_URL: fixture.url, TOOLS_TEST_DATABASE_CONFIRM: "tools-platform-test", MONEY_TEST_DATABASE_CONFIRM: "money-repository-test" };
                cell.result = commandResult(await commands.execute(spec("pnpm", ["run", "db:push-postgres:test"], "schema", 120_000, env, toolsRoot)));
                break;
              }
              case "contracts": {
                if (!fixture) throw new Error("No verified PostgreSQL fixture.");
                const env = { ...process.env, TEST_DATABASE_URL: fixture.url, MONEY_TEST_DATABASE_CONFIRM: "money-repository-test" };
                const result = await childReport("run", commands, directory, env, work.signal, redact);
                contracts = requiredCaseReceipt(required, result.report?.observed ?? [], result.errors);
                cell.result = commandResult(result.outcome);
                if (result.outcome.kind === "succeeded" && contracts.result !== "passed") cell.result = { kind: "failed", reasons: contracts.evidence, evidence: [join(directory, "run-report.json")] };
                break;
              }
              case "identity-contracts": {
                if (!fixture) throw new Error("No verified PostgreSQL fixture.");
                const databaseUrl = fixture.url;
                let identityResult: StepResult = { kind: "pending" };
                const local = await withVerificationStack({
                  commands: { work: commands, cleanup: cleanupCommands },
                  environment: process.env, signal: work.signal, lifetimeMs: 900_000,
                }, async (stack) => {
                  identityFixture = stack.manifest;
                  if (stack.manifest.prerequisites.storageHttp.kind !== "passed") {
                    throw new VerificationBlocked(stack.manifest.prerequisites.storageHttp.reason);
                  }
                  const env = {
                    ...process.env, TEST_DATABASE_URL: databaseUrl, MONEY_TEST_DATABASE_CONFIRM: "money-repository-test",
                    PUBLISHER_TRANSFER_TEST_DATABASE_URL: databaseUrl,
                    PUBLISHER_TRANSFER_TEST_S3_ENDPOINT: stack.environment.ARTIFACT_S3_ENDPOINT,
                    PUBLISHER_TRANSFER_TEST_ORIGIN: stack.manifest.origins.tools,
                    PUBLISHER_TRANSFER_TEST_S3_ACCESS_KEY_ID: stack.environment.ARTIFACT_S3_ACCESS_KEY_ID,
                    PUBLISHER_TRANSFER_TEST_S3_SECRET_ACCESS_KEY: stack.environment.ARTIFACT_S3_SECRET_ACCESS_KEY,
                  };
                  const result = await childReport("run", commands, directory, env, stack.signal, redact, "identity");
                  identityContracts = requiredCaseReceipt(identityRequired, result.report?.observed ?? [], result.errors);
                  identityResult = commandResult(result.outcome);
                  if (result.outcome.kind === "succeeded" && identityContracts.result !== "passed") identityResult = { kind: "failed", reasons: identityContracts.evidence, evidence: [join(directory, "identity-run-report.json")] };
                  if (identityResult.kind !== "passed") throw new Error("Required identity contracts did not pass.");
                });
                identityFixture ??= local.manifest;
                cell.result = identityResult;
                if (local.kind !== "completed" || local.cleanup !== "disposed") {
                  cell.result = { kind: local.kind === "blocked" ? "blocked" : "failed", reasons: [local.reason ?? "Local identity fixture did not complete cleanup."], evidence: [local.directory] };
                }
                break;
              }
            }
          }
        } catch (error) {
          current.result = { kind: error instanceof VerificationBlocked ? "blocked" : "failed", reasons: [redact((error as Error).message)], evidence: [] };
        } finally {
          const cleanup = cells.find((cell) => cell.requirement.kind === "cleanup")!;
          try {
            if (fixture) {
              const closed = await fixture.close();
              fixtureState = `${closed.name} ${closed.kind}`;
              cleanup.result = closed.kind === "cleaned" ? { kind: "passed", evidence: [fixtureState] }
                : { kind: "failed", reasons: [closed.reason], evidence: [fixtureState] };
            } else cleanup.result = { kind: "passed", evidence: ["No verified fixture lease to close."] };
          } catch (error) {
            cleanup.result = { kind: "failed", reasons: [redact((error as Error).message)], evidence: [fixtureState] };
          }
        }
      });
    });
  } catch (error) {
    current.result = { kind: "failed", reasons: [redact((error as Error).message)], evidence: [] };
  }
  for (const cell of cells) {
    if (cell.result.kind === "pending") cell.result = { kind: "not-run", reasons: ["Execution stopped before this step."], evidence: [] };
  }
  const snapshot = (): RunRecord => ({
    mode, revision, fixture: fixtureState,
    cells: cells.map((cell) => ({ requirement: cell.requirement, result: cell.result })),
    required, contracts, identity: { required: identityRequired, contracts: identityContracts, fixture: identityFixture },
    interruption, decision: decide(cells, interruption),
  });
  const path = join(directory, "receipts.json");
  const temporary = `${path}.tmp`;
  let draft: string | undefined;
  try {
    draft = JSON.stringify(snapshot(), null, 2);
    await writeFile(temporary, draft, { mode: 0o600 });
  } catch (error) {
    failure = { stage: "draft-write", reason: redact((error as Error).message) };
  }
  await new Promise<void>((resolve) => setImmediate(resolve));

  // Signal handlers can update the record until this synchronous suffix.
  sealed = true;
  const record = snapshot();
  let completion: Completion;
  try {
    if (failure) throw new Error(failure.reason);
    const final = JSON.stringify(record, null, 2);
    if (final !== draft) writeFileSync(temporary, final, { mode: 0o600 });
    renameSync(temporary, path);
    completion = { kind: "published", path };
  } catch {
    completion = { kind: "unpublished", stage: failure?.stage ?? "final-write-or-rename" };
    try { unlinkSync(temporary); } catch {}
    try { writeSync(2, `${JSON.stringify({ completion, interruption: record.interruption, decision: record.decision })}\n`); } catch {}
  }
  const exit = record.interruption.kind === "received" ? interruptedExit[record.interruption.first]
    : completion.kind === "published" && record.decision.kind === "passed" ? 0 : 1;
  try { writeSync(1, `${JSON.stringify({ completion, decision: record.decision, interruption: record.interruption, exit })}\n`); } catch {}
  process.exit(exit);
}
