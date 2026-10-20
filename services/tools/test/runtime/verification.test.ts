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
  export async function withVerificationStack(options,use) {
    const directory=process.env.FIXTURE_DIRECTORY;
    if(process.env.FIXTURE_LOCAL_BLOCKED) return {kind:'blocked',reason:'local fixture unavailable',cleanup:'retained',directory};
    const controller = new AbortController();
    const pending = use({manifest:{project:'identity-project',origins:{tools:'http://127.0.0.1:9'},prerequisites:{storageHttp:{kind:'passed',reason:'fixture'}}},
      environment:{ARTIFACT_S3_ENDPOINT:'http://127.0.0.1:9',ARTIFACT_S3_ACCESS_KEY_ID:'local',ARTIFACT_S3_SECRET_ACCESS_KEY:'local'},
      signal:controller.signal});
    if(process.env.FIXTURE_LOCAL_HOST_FAIL) {
      await new Promise(resolve=>setTimeout(resolve,150));
      controller.abort();
      await pending.catch(()=>{});
      return {kind:'failed',reason:'owned host failed',cleanup:'retained',directory};
    }
    try { await pending; } catch {
      appendFileSync(process.env.FIXTURE_TRACE!, 'identity-retained\\n');
      return {kind:'failed',reason:'identity contracts failed',cleanup:'retained',directory};
    }
    if(!process.env.FIXTURE_LOCAL_CLEANUP_FAIL) appendFileSync(process.env.FIXTURE_TRACE!, 'identity-disposed\\n');
    return {kind:'completed',cleanup:process.env.FIXTURE_LOCAL_CLEANUP_FAIL?'retained':'disposed',directory};
  }`);
  await writeFile(join(target, "vitest-child.ts"), `import {writeFileSync} from 'node:fs';
const phase=process.argv[2];
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
    return { code, stdout, stderr, record: text ? JSON.parse(text) : undefined, trace: await readFile(join(directory, "trace"), "utf8").catch(() => "") };
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
    expect(result.record.decision).toEqual({ kind: "passed" });
    expect(result.record.cells.map((cell: { requirement: { kind: string } }) => cell.requirement.kind)).toEqual(["prerequisites", "discover", "fixture", "schema", "contracts", "cleanup"]);
    expect(result.record.contracts).toMatchObject({ required: ["required case"], executed: ["required case"], skipped: [] });
    expect(result.trace.match(/cleanup/g)).toHaveLength(1);
  });

  it.each([{ FIXTURE_EMPTY: "1" }, { FIXTURE_SKIP: "1" }])("fails on an empty or skipped required case set %j", async (environment) => {
    const result = await run(environment);
    expect(result.code).toBe(1);
    expect(result.record.decision.kind).toBe("failed");
    const stage = environment.FIXTURE_EMPTY ? "discover" : "contracts";
    expect(result.record.cells.find((cell: { requirement: { kind: string } }) => cell.requirement.kind === stage).result.kind).toBe("failed");
  });

  it.each(["FIXTURE_SETUP_THROW", "FIXTURE_CLEANUP_THROW"])("publishes a failed record after %s", async (name) => {
    const result = await run({ [name]: "1" });
    expect(result.code).toBe(1);
    expect(result.record.decision.kind).toBe("failed");
    const stage = name === "FIXTURE_SETUP_THROW" ? "fixture" : "cleanup";
    expect(result.record.cells.find((cell: { requirement: { kind: string } }) => cell.requirement.kind === stage).result.reasons.join(" ")).toContain("rejected");
    expect(JSON.stringify(result.record)).not.toContain("private-password");
  });

  it("requires the identity suite and its owned local fixture before workspace success", async () => {
    const result = await run({ FIXTURE_MODE: "workspace" });
    expect(result.code).toBe(0);
    expect(result.record.identity).toMatchObject({ required: ["required case"], contracts: { executed: ["required case"], skipped: [] } });
    expect(result.record.cells.filter((cell: { requirement: { kind: string } }) => cell.requirement.kind.startsWith("identity-")).map((cell: { result: { kind: string } }) => cell.result.kind)).toEqual(["passed", "passed"]);
    expect(result.trace).toContain("identity-disposed");
  });

  it.each(["FIXTURE_IDENTITY_EMPTY", "FIXTURE_IDENTITY_SKIP", "FIXTURE_LOCAL_BLOCKED", "FIXTURE_LOCAL_CLEANUP_FAIL"])("does not pass workspace verification with %s", async (name) => {
    const result = await run({ FIXTURE_MODE: "workspace", [name]: "1" });
    expect(result.code).toBe(1);
    expect(result.record.decision.kind).not.toBe("passed");
    expect(result.record.cells.filter((cell: { requirement: { kind: string } }) => cell.requirement.kind.startsWith("identity-")).some((cell: { result: { kind: string } }) => cell.result.kind !== "passed")).toBe(true);
    if (name === "FIXTURE_IDENTITY_SKIP") {
      expect(result.trace).toContain("identity-retained");
      expect(result.trace).not.toContain("identity-disposed");
    }
  });

  it("cancels identity contracts when their owned host fails and keeps the fixture failure", async () => {
    const result = await run({ FIXTURE_MODE: "workspace", FIXTURE_LOCAL_HOST_FAIL: "1" });
    expect(result.code).toBe(1);
    expect(result.record.identity.contracts.result).toBe("failed");
    const identity = result.record.cells.find((cell: { requirement: { kind: string } }) => cell.requirement.kind === "identity-contracts");
    expect(identity.result).toMatchObject({ kind: "failed", reasons: ["owned host failed"] });
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
    expect(result.record.decision).toEqual({ kind: "interrupted", first: signal });
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
