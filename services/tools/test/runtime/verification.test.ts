import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const runtime = fileURLToPath(new URL("./", import.meta.url));
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "verification-cli-"));
  const target = join(directory, "services/tools/test/runtime");
  await mkdir(target, { recursive: true });
  await mkdir(join(directory, "bin"));
  await writeFile(join(directory, "bin/package.json"), '{"type":"commonjs"}');
  for (const file of ["verification.ts", "commands.ts", "command-types.ts", "command-anchor.cjs", "receipt.ts"]) await copyFile(join(runtime, file), join(target, file));
  await writeFile(join(directory, "package.json"), '{"type":"module"}');
  await writeFile(join(target, "entry.ts"), `import { runVerification } from './verification.ts';
setTimeout(() => process.exit(99), 10_000);
await runVerification(process.env.FIXTURE_MODE === 'workspace' ? 'workspace' : 'money-postgres', {artifactParent: process.env.FIXTURE_DIRECTORY!});`);
  await writeFile(join(target, "postgres.ts"), `import {appendFileSync} from 'node:fs';
export const rejectInheritedDataEndpoints = () => {};
export async function createOwnedPostgres() {
  if(process.env.FIXTURE_SETUP_THROW) throw new Error('setup rejected');
  return {kind:'ready',fixture:{name:'owned-fixture',url:'postgres://local:private-password@127.0.0.1:9/test',async close(){
    appendFileSync(process.env.FIXTURE_TRACE!, 'cleanup\\n');
    if(process.env.FIXTURE_CLEANUP_THROW) throw new Error('cleanup rejected private-password');
    return {kind:'cleaned',name:'owned-fixture'};
  }}};
}`);
  await writeFile(join(target, "local-stack.ts"), `import {appendFileSync} from 'node:fs';
  let calls = 0;
  export async function withVerificationStack(options,use) {
    const journey=++calls===2;
    const name=journey?'journey':'identity';
    const directory=process.env.FIXTURE_DIRECTORY;
    if(process.env.FIXTURE_LOCAL_BLOCKED) return {kind:'blocked',reason:'local fixture unavailable',cleanup:'retained',directory};
    const controller = new AbortController();
    const pending = use({manifest:{project:name+'-project',origins:{tools:'http://127.0.0.1:9'},prerequisites:{storageHttp:{kind:'passed',reason:'fixture'}}},
      environment:{UPLOAD_TOKEN:'local-upload-token',TOWER_HEARTBEAT_TOKEN:'local-heartbeat-token',DATABASE_URL:'postgres://local:local-password@127.0.0.1:9/postgres',
        ARTIFACT_S3_ENDPOINT:'http://127.0.0.1:9',ARTIFACT_S3_ACCESS_KEY_ID:'storage-access',ARTIFACT_S3_SECRET_ACCESS_KEY:'storage-secret'},
      signal:controller.signal});
    if(process.env.FIXTURE_LOCAL_HOST_FAIL || journey && process.env.FIXTURE_JOURNEY_HOST_FAIL) {
      await new Promise(resolve=>setTimeout(resolve,150));
      controller.abort();
      await pending.catch(()=>{});
      appendFileSync(process.env.FIXTURE_TRACE!, name+'-retained\\n');
      return {kind:'failed',reason:'owned host failed',cleanup:'retained',directory};
    }
    try { await pending; } catch {
      appendFileSync(process.env.FIXTURE_TRACE!, name+'-retained\\n');
      return {kind:'failed',reason:name+' contracts failed',cleanup:'retained',directory};
    }
    const retained=process.env.FIXTURE_LOCAL_CLEANUP_FAIL || journey && process.env.FIXTURE_JOURNEY_CLEANUP_FAIL;
    const stopped=journey && process.env.FIXTURE_JOURNEY_CLEANUP_STOPPED;
    if(!retained && !stopped) appendFileSync(process.env.FIXTURE_TRACE!, name+'-disposed\\n');
    return {kind:'completed',cleanup:retained?'retained':stopped?'stopped':'disposed',directory};
  }`);
  await writeFile(join(target, "vitest-child.ts"), `import {readFileSync,writeFileSync} from 'node:fs';
import {requiredJourneyCases,mountedStatusCase} from './receipt.ts';
const phase=process.argv[2];
if(process.argv[4]==='journeys') {
  const controls=JSON.parse(readFileSync(new URL('../../../../fixture-controls.json',import.meta.url),'utf8'));
  const required=controls.FIXTURE_JOURNEY_MISSING ? requiredJourneyCases.filter(identity=>identity!==mountedStatusCase)
    : controls.FIXTURE_JOURNEY_UNKNOWN ? [...requiredJourneyCases,'unknown case']
    : controls.FIXTURE_JOURNEY_DUPLICATE ? [...requiredJourneyCases,requiredJourneyCases[0]] : requiredJourneyCases;
  if(phase==='run' && controls.FIXTURE_JOURNEY_HOST_FAIL) await new Promise(resolve=>setTimeout(resolve,3000));
  if(phase==='run' && controls.FIXTURE_JOURNEY_NO_REPORT) process.exit(0);
  const observed=required.map(identity=>({identity,result:controls.FIXTURE_JOURNEY_SKIP?'skipped':controls.FIXTURE_JOURNEY_PENDING?'pending':controls.FIXTURE_JOURNEY_BLOCKED?'blocked':'passed',
    evidence:controls.FIXTURE_JOURNEY_LEAK ? ['local-upload-token local-heartbeat-token storage-access storage-secret local-password'] : []}));
  if(phase==='run' && controls.FIXTURE_JOURNEY_LEAK) console.log('local-upload-token local-heartbeat-token storage-access storage-secret local-password');
  if(controls.FIXTURE_JOURNEY_REPORT_DUPLICATE) observed.push(observed[0]);
  if(controls.FIXTURE_JOURNEY_REPORT_UNKNOWN) observed.push({identity:'unknown reported case',result:'passed',evidence:[]});
  writeFileSync(process.argv[3],JSON.stringify(phase==='discover'
    ? {phase,required,errors:[]}
    : {phase,observed,errors:controls.FIXTURE_JOURNEY_HOOK_FAIL?['mounted Status afterAll failed']:[]}));
  process.exit(phase==='run' && (controls.FIXTURE_JOURNEY_BLOCKED || controls.FIXTURE_JOURNEY_HOOK_FAIL || controls.FIXTURE_JOURNEY_EXIT_FAIL)?1:0);
}
const identity=process.argv[4]==='identity';
if(identity && phase==='run' && process.env.FIXTURE_LOCAL_HOST_FAIL) await new Promise(resolve=>setTimeout(resolve,3000));
writeFileSync(process.argv[3]!,JSON.stringify(phase==='discover'
  ? {phase,required:process.env.FIXTURE_EMPTY || identity && process.env.FIXTURE_IDENTITY_EMPTY?[]:['required case'],errors:[]}
  : {phase,observed:[{identity:'required case',result:process.env.FIXTURE_SKIP || identity && process.env.FIXTURE_IDENTITY_SKIP?'skipped':'passed',evidence:[]}],errors:[]}));`);
  for (const command of ["git", "pnpm"]) {
    const path = join(directory, "bin", command);
    await writeFile(path, `#!${process.execPath}
const fs=require('node:fs');
fs.appendFileSync(process.env.FIXTURE_TRACE,JSON.stringify(process.argv.slice(2))+'\\n');
if(process.argv[2]==='rev-parse') console.log('fixture-revision');
if(process.argv[3]===process.env.FIXTURE_FAIL_COMMAND) process.exit(2);
`);
    await chmod(path, 0o700);
  }
  await writeFile(join(directory, "hook.mjs"), `import {register} from 'node:module';
register(new URL('./loader.mjs',import.meta.url),import.meta.url);`);
  await writeFile(join(directory, "loader.mjs"), `export async function resolve(specifier,context,next){
  if(specifier==='node:fs/promises' && context.parentURL?.endsWith('/verification.ts')) return {url:new URL('./barrier.mjs',import.meta.url).href,shortCircuit:true};
  return next(specifier,context);
}`);
  await writeFile(join(directory, "barrier.mjs"), `export * from 'node:fs/promises';
import {writeFile as actual} from 'node:fs/promises';
import {existsSync,writeFileSync} from 'node:fs';
export async function writeFile(path,...args){
  if(String(path).endsWith('receipts.json.tmp')) {
    if(process.env.FIXTURE_WRITE_FAIL) throw new Error('EIO');
    if(process.env.FIXTURE_BARRIER) {
      writeFileSync(process.env.FIXTURE_DIRECTORY+'/pending','ready');
      const until=Date.now()+2000;
      while(!existsSync(process.env.FIXTURE_DIRECTORY+'/release') && Date.now()<until) await new Promise(r=>setTimeout(r,5));
      if(!existsSync(process.env.FIXTURE_DIRECTORY+'/release')) throw new Error('barrier timed out');
    }
  }
  return actual(path,...args);
}`);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function waitFile(path: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await readFile(path, "utf8").catch(() => "")) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("The fixture barrier did not open.");
}

async function run(environment: NodeJS.ProcessEnv = {}, observe?: (send: (signal: NodeJS.Signals) => void) => Promise<void>) {
  await writeFile(join(directory, "fixture-controls.json"), JSON.stringify(environment));
  const child = spawn(process.execPath, ["--import", join(directory, "hook.mjs"), "--experimental-strip-types", join(directory, "services/tools/test/runtime/entry.ts")], {
    env: { PATH: `${join(directory, "bin")}:${process.env.PATH}`, HOME: process.env.HOME, FIXTURE_DIRECTORY: directory, FIXTURE_TRACE: join(directory, "trace"), ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", reject);
  });
  const bound = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 12_000);
  try {
    if (observe) await observe((signal) => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); });
    const code = await exited;
    const runs = (await readdir(directory)).filter((name) => name.startsWith("runtime-"));
    const path = runs.length ? join(directory, runs[0]!, "receipts.json") : "";
    const text = await readFile(path, "utf8").catch(() => undefined);
    const evidence = runs.length ? (await Promise.all((await readdir(join(directory, runs[0]!)))
      .filter((name) => name.endsWith(".log") || name.endsWith(".json"))
      .map((name) => readFile(join(directory, runs[0]!, name), "utf8")))).join("\n") : "";
    return { code, stdout, stderr, evidence, record: text ? JSON.parse(text) : undefined, trace: await readFile(join(directory, "trace"), "utf8").catch(() => "") };
  } finally {
    clearTimeout(bound);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}

describe("terminal verification CLI", () => {
  it("publishes one complete plan and succeeds only when every required case runs", async () => {
    const result = await run();
    expect(result.code).toBe(0);
    expect(result.record.automatedDecision).toEqual({ kind: "passed" });
    expect(result.record.cells.map((cell: { requirement: { kind: string } }) => cell.requirement.kind)).toEqual(["prerequisites", "discover", "fixture", "schema", "contracts", "cleanup"]);
    expect(result.record.contracts).toMatchObject({ required: ["required case"], executed: ["required case"], skipped: [] });
    expect(result.trace.match(/cleanup/g)).toHaveLength(1);
  });

  it.each([{ FIXTURE_EMPTY: "1" }, { FIXTURE_SKIP: "1" }])("fails on an empty or skipped required case set %j", async (environment) => {
    const result = await run(environment);
    expect(result.code).toBe(1);
    expect(result.record.automatedDecision.kind).toBe("failed");
    const stage = environment.FIXTURE_EMPTY ? "discover" : "contracts";
    expect(result.record.cells.find((cell: { requirement: { kind: string } }) => cell.requirement.kind === stage).result.kind).toBe("failed");
  });

  it.each(["FIXTURE_SETUP_THROW", "FIXTURE_CLEANUP_THROW"])("publishes a failed record after %s", async (name) => {
    const result = await run({ [name]: "1" });
    expect(result.code).toBe(1);
    expect(result.record.automatedDecision.kind).toBe("failed");
    const stage = name === "FIXTURE_SETUP_THROW" ? "fixture" : "cleanup";
    expect(result.record.cells.find((cell: { requirement: { kind: string } }) => cell.requirement.kind === stage).result.reasons.join(" ")).toContain("rejected");
    expect(JSON.stringify(result.record)).not.toContain("private-password");
  });

  it("requires identity, built Tools, and mounted Status receipts before workspace success", async () => {
    const result = await run({ FIXTURE_MODE: "workspace" });
    expect(result.code).toBe(0);
    expect(result.record.journeys.some((receipt: { suite: string; result: string }) => receipt.suite === "mounted-status" && receipt.result === "passed")).toBe(true);
    expect(result.record.identity).toMatchObject({ required: ["required case"], contracts: { executed: ["required case"], skipped: [] } });
    expect(result.record.cells.filter((cell: { requirement: { kind: string } }) => cell.requirement.kind.startsWith("identity-")).map((cell: { result: { kind: string } }) => cell.result.kind)).toEqual(["passed", "passed"]);
    expect(result.trace).toContain("identity-disposed");
    expect(result.trace).toContain("journey-disposed");
    expect(result.record).not.toHaveProperty("decision");
    expect(result.record.manualAcceptance).toMatchObject({ kind: "blocked", owner: "Max", revision: "fixture-revision" });
    expect(result.record.manualAcceptance.gates).toHaveLength(3);
    expect(result.record.manualAcceptance.gates.every((gate: { result: string; revision: string }) => gate.result === "blocked" && gate.revision === "fixture-revision")).toBe(true);
    expect(JSON.parse(result.stdout.trim()).manualAcceptance.kind).toBe("blocked");
  });

  it.each(["FIXTURE_JOURNEY_MISSING", "FIXTURE_JOURNEY_UNKNOWN", "FIXTURE_JOURNEY_DUPLICATE", "FIXTURE_JOURNEY_SKIP", "FIXTURE_JOURNEY_PENDING", "FIXTURE_JOURNEY_BLOCKED", "FIXTURE_JOURNEY_HOOK_FAIL", "FIXTURE_JOURNEY_EXIT_FAIL", "FIXTURE_JOURNEY_NO_REPORT", "FIXTURE_JOURNEY_REPORT_DUPLICATE", "FIXTURE_JOURNEY_REPORT_UNKNOWN"])("cannot pass workspace verification with %s", async (name) => {
    const result = await run({ FIXTURE_MODE: "workspace", [name]: "1" });
    expect(result.code).toBe(1);
    expect(result.record.automatedDecision.kind).toBe("failed");
    if (!["FIXTURE_JOURNEY_MISSING", "FIXTURE_JOURNEY_UNKNOWN", "FIXTURE_JOURNEY_DUPLICATE"].includes(name)) {
      expect(result.trace).toContain("journey-retained");
      expect(result.trace).not.toContain("journey-disposed");
    }
    expect(result.record.journeys.some((receipt: { result: string }) => receipt.result !== "passed")).toBe(true);
  });

  it.each(["FIXTURE_IDENTITY_EMPTY", "FIXTURE_IDENTITY_SKIP", "FIXTURE_LOCAL_BLOCKED", "FIXTURE_LOCAL_CLEANUP_FAIL"])("does not pass workspace verification with %s", async (name) => {
    const result = await run({ FIXTURE_MODE: "workspace", [name]: "1" });
    expect(result.code).toBe(1);
    expect(result.record.automatedDecision.kind).not.toBe("passed");
    expect(result.record.cells.filter((cell: { requirement: { kind: string } }) => cell.requirement.kind.startsWith("identity-")).some((cell: { result: { kind: string } }) => cell.result.kind !== "passed")).toBe(true);
    if (name === "FIXTURE_IDENTITY_SKIP") {
      expect(result.trace).toContain("identity-retained");
      expect(result.trace).not.toContain("identity-disposed");
    }
  });

  it.each(["FIXTURE_JOURNEY_CLEANUP_FAIL", "FIXTURE_JOURNEY_CLEANUP_STOPPED"])("fails the journey cell when disposal is incomplete through %s", async (name) => {
    const result = await run({ FIXTURE_MODE: "workspace", [name]: "1" });
    expect(result.code).toBe(1);
    expect(result.record.automatedDecision.kind).toBe("failed");
    expect(result.record.cells.filter((cell: { requirement: { kind: string } }) => cell.requirement.kind.startsWith("identity-")).map((cell: { result: { kind: string } }) => cell.result.kind)).toEqual(["passed", "passed"]);
    const journey = result.record.cells.find((cell: { requirement: { kind: string } }) => cell.requirement.kind === "journey-contracts");
    expect(journey.result).toMatchObject({ kind: "failed", reasons: ["Journey fixture did not complete cleanup."] });
  });

  it("cancels identity contracts when their owned host fails and keeps the fixture failure", async () => {
    const result = await run({ FIXTURE_MODE: "workspace", FIXTURE_LOCAL_HOST_FAIL: "1" });
    expect(result.code).toBe(1);
    expect(result.record.identity.contracts.result).toBe("failed");
    const identity = result.record.cells.find((cell: { requirement: { kind: string } }) => cell.requirement.kind === "identity-contracts");
    expect(identity.result).toMatchObject({ kind: "failed", reasons: ["owned host failed"] });
  });

  it("cancels and settles journey work before a failed host can dispose its fixture", async () => {
    const result = await run({ FIXTURE_MODE: "workspace", FIXTURE_JOURNEY_HOST_FAIL: "1" });
    expect(result.code).toBe(1);
    const journey = result.record.cells.find((cell: { requirement: { kind: string } }) => cell.requirement.kind === "journey-contracts");
    expect(journey.result).toMatchObject({ kind: "failed", reasons: ["owned host failed"] });
    expect(result.trace).toContain("identity-disposed");
    expect(result.trace).toContain("journey-retained");
    expect(result.trace).not.toContain("journey-disposed");
  });

  it("removes all fixture secrets from command logs and final receipts", async () => {
    const result = await run({ FIXTURE_MODE: "workspace", FIXTURE_JOURNEY_LEAK: "1" });
    expect(result.code).toBe(0);
    const receipts = JSON.stringify(result.record);
    for (const secret of ["local-upload-token", "local-heartbeat-token", "storage-access", "storage-secret", "local-password"]) {
      expect(receipts).not.toContain(secret);
      expect(result.stdout).not.toContain(secret);
      expect(result.evidence).not.toContain(secret);
    }
  });

  it("stops workspace admission after the first command failure and still cleans up", async () => {
    const result = await run({ FIXTURE_MODE: "workspace", FIXTURE_FAIL_COMMAND: "typecheck" });
    expect(result.code).toBe(1);
    expect(result.trace).toContain('["run","typecheck"]');
    expect(result.trace).not.toContain('["run","test"]');
    expect(result.trace).toContain("cleanup");
  });

  it.each(["SIGINT", "SIGTERM"] as const)("keeps %s during the async draft in both receipt and exit", async (signal) => {
    const result = await run({ FIXTURE_BARRIER: "1" }, async (send) => {
      await waitFile(join(directory, "pending"));
      send(signal);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writeFile(join(directory, "release"), "continue");
    });
    expect(result.code).toBe(signal === "SIGINT" ? 130 : 143);
    expect(result.record.interruption).toEqual({ kind: "received", first: signal });
    expect(result.record.automatedDecision).toEqual({ kind: "interrupted", first: signal });
  });

  it("keeps the first signal when more signals arrive during publication", async () => {
    const result = await run({ FIXTURE_BARRIER: "1" }, async (send) => {
      await waitFile(join(directory, "pending"));
      send("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 30));
      send("SIGTERM");
      await writeFile(join(directory, "release"), "continue");
    });
    expect(result.code).toBe(130);
    expect(result.record.interruption.first).toBe("SIGINT");
  });

  it("returns nonzero and fallback evidence when publication fails", async () => {
    const result = await run({ FIXTURE_WRITE_FAIL: "1" });
    expect(result.code).toBe(1);
    expect(result.record).toBeUndefined();
    expect(result.stderr).toContain('"kind":"unpublished"');
  });
});
