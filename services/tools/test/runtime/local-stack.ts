import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandExecutor, CommandOutcome } from "./commands.ts";
import { rejectInheritedDataEndpoints } from "./postgres.ts";
import { VerificationBlocked } from "./receipt.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type ComposePort = { target: number; published?: string; host_ip?: string; protocol?: string };
type ComposeService = { environment?: Record<string, string>; ports?: ComposePort[]; container_name?: string };
type ComposeConfig = { services: Record<string, ComposeService>; volumes?: Record<string, { name?: string; external?: boolean }> };
type Binding = Readonly<{ service: string; target: number; port: number }>;
type Identity = { version: 1; project: string; feedbackKey: string; bindings?: readonly Binding[] };
export type LocalPrerequisite = Readonly<{ kind: "passed" | "blocked"; reason: string }>;
export type LocalStackManifest = Readonly<{
  project: string;
  directory: string;
  origins: Readonly<{ tools: string; storage: string; storageConsole: string; markdownAdmin: string }>;
  bindings: readonly Binding[];
  volumes: readonly string[];
  prerequisites: Readonly<Record<"config" | "storageHttp" | "publisherBrowser" | "privateOAuth" | "markdownBrowser" | "statusPublication", LocalPrerequisite>>;
}>;
export type LocalStackOptions = Readonly<{
  directory: string;
  commands: { work: CommandExecutor; cleanup: CommandExecutor };
  environment: Environment;
  signal?: AbortSignal;
  lifetimeMs: number;
  repository?: string;
}>;

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const checkEntry = fileURLToPath(new URL("./local-stack-check.ts", import.meta.url));
const dockerHost = "unix:///var/run/docker.sock";
const dependencies = ["postgres", "minio", "markdown-mock"];
const blocked = (reason: string): LocalPrerequisite => ({ kind: "blocked", reason });

class SetupError extends Error {
  readonly kind: "blocked" | "failed";
  constructor(kind: "blocked" | "failed", message: string) { super(message); this.kind = kind; }
}

function within(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function privateDirectory(directory: string, root: string) {
  if (!isAbsolute(directory)) throw new SetupError("blocked", "Use an absolute owned run directory outside the checkout.");
  if (within(root, resolve(directory))) throw new SetupError("blocked", "The private run directory must be outside the checkout.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(directory);
  if (within(root, canonical)) throw new SetupError("blocked", "The private run directory resolves into the checkout.");
  const metadata = await stat(canonical);
  if (process.getuid && metadata.uid !== process.getuid()) throw new SetupError("blocked", "The run directory belongs to another user.");
  const files = await readdir(canonical);
  if (files.length && !files.includes("identity.json")) throw new SetupError("blocked", "Use an empty run directory or one with its retained local stack identity.");
  await chmod(canonical, 0o700);
  return canonical;
}

async function identity(directory: string): Promise<Identity> {
  const path = join(directory, "identity.json");
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const value: Identity = { version: 1, project: `tools-local-${randomUUID()}`, feedbackKey: randomBytes(32).toString("base64url") };
    await writeFile(path, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    return value;
  }
  const value = JSON.parse(raw) as Identity;
  if (value.version !== 1 || !/^tools-local-[a-f0-9-]{36}$/.test(value.project)
    || !/^[A-Za-z0-9_-]{43}$/.test(value.feedbackKey) || Buffer.from(value.feedbackKey, "base64url").length !== 32) {
    throw new SetupError("blocked", "The run identity is invalid. Retain its key and volumes for recovery.");
  }
  if (value.bindings === undefined) {
    const files = await readdir(directory);
    if (files.includes("manifest.json")) {
      const retained = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as LocalStackManifest;
      if (retained.project !== value.project || !retained.bindings) throw new SetupError("blocked", "The retained manifest does not match the run identity. Retain the directory for recovery.");
      value.bindings = retained.bindings;
    } else if (files.includes("compose.override.yaml")) {
      throw new SetupError("blocked", "The retained configuration has no port identity. Retain the directory for recovery instead of selecting new ports.");
    }
  }
  if (value.bindings !== undefined && (!Array.isArray(value.bindings) || !value.bindings.length
    || value.bindings.some((binding) => !binding || typeof binding.service !== "string" || !binding.service
      || !Number.isInteger(binding.target) || binding.target < 1 || binding.target > 65_535
      || !Number.isInteger(binding.port) || binding.port < 1 || binding.port > 65_535)
    || new Set(value.bindings.map((binding) => binding.port)).size !== value.bindings.length
    || new Set(value.bindings.map((binding) => JSON.stringify([binding.service, binding.target]))).size !== value.bindings.length)) {
    throw new SetupError("blocked", "The retained port identity is invalid. Retain the directory for recovery.");
  }
  await chmod(path, 0o600);
  return value;
}

async function unusedPort(used: Set<number>, retainedPort = 0) {
  for (;;) {
    const server = createServer();
    try {
      await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(retainedPort, "127.0.0.1", accept); });
    } catch (error) {
      if (retainedPort) throw new SetupError("blocked", `Retained binding 127.0.0.1:${retainedPort} is unavailable. Stop its owner before restarting. The binding will not change.`);
      throw error;
    }
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
    if (port && !used.has(port)) { used.add(port); return port; }
  }
}

function decodeCompose(raw: string): ComposeConfig {
  const config = JSON.parse(raw) as ComposeConfig;
  if (!config.services || ["platform", "postgres", "minio", "markdown-mock", "postgres-migrate", "minio-seed"].some((name) => !config.services[name])) {
    throw new SetupError("blocked", "Root Compose does not contain the required local services.");
  }
  if (Object.values(config.services).some((service) => service.container_name)
    || Object.values(config.volumes ?? {}).some((volume) => volume.external)) {
    throw new SetupError("blocked", "Compose must use project-owned containers and volumes.");
  }
  return config;
}

function loopbackOrigin(value: string | undefined, name: string) {
  const url = new URL(value ?? "");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new SetupError("blocked", `${name} must use the owned HTTP loopback origin.`);
  }
  return url.origin;
}

function hostSettings(base: ComposeConfig, bindings: LocalStackManifest["bindings"], key: string): Environment {
  const port = (service: string, target: number) => {
    const value = bindings.find((binding) => binding.service === service && binding.target === target)?.port;
    if (!value) throw new SetupError("blocked", `Compose must publish ${service} port ${target}.`);
    return value;
  };
  const env: Record<string, string | undefined> = {
    ...base.services.platform!.environment,
    NODE_ENV: "development", HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1",
    PORT: String(port("platform", 3000)),
    PUBLIC_ORIGIN: `http://127.0.0.1:${port("platform", 3000)}`,
    DATABASE_URL: `postgres://local:local@127.0.0.1:${port("postgres", 5432)}/postgres`,
    TOOLS_S3_ENDPOINT: `http://127.0.0.1:${port("minio", 9000)}`,
    ARTIFACT_S3_ENDPOINT: `http://127.0.0.1:${port("minio", 9000)}`,
    MARKDOWN_SHARE_ADMIN_ENDPOINT: `http://127.0.0.1:${port("markdown-mock", 8787)}/admin/documents`,
    FEEDBACK_ENCRYPTION_KEY: key,
  };
  for (const name of ["PUBLIC_ORIGIN", "TOOLS_S3_ENDPOINT", "ARTIFACT_S3_ENDPOINT"]) loopbackOrigin(env[name], name);
  return env;
}

function secrets(env: Environment): string[] {
  return Object.entries(env).filter(([name, value]) => value && /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(name)).map(([, value]) => value!).sort((a, b) => b.length - a.length);
}

export type LocalStackResult = Readonly<{
  kind: "completed" | "blocked" | "failed";
  manifest?: LocalStackManifest;
  reason?: string;
  cleanup: "not-needed" | "stopped" | "retained";
}>;

export async function withLocalStack(
  options: LocalStackOptions,
  use: (stack: Readonly<{ manifest: LocalStackManifest; environment: Environment; signal: AbortSignal; expiresAt: number }>) => Promise<void>,
): Promise<LocalStackResult> {
  let directory: string | undefined;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let manifest: LocalStackManifest | undefined;
  let down: (() => Promise<void>) | undefined;
  let host: Promise<CommandOutcome> | undefined;
  let operation: Promise<void> | undefined;
  let probe: Promise<string> | undefined;
  let ownershipUncertain = false;
  let result: LocalStackResult = { kind: "failed", reason: "Local setup did not finish.", cleanup: "not-needed" };
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  let sensitive: string[] = [];
  const redact = (text: string) => {
    for (const value of sensitive) text = text.replaceAll(value, "[redacted]");
    return text.replace(/([?&]X-Amz-[^=\s]+)=([^&\s]+)/gi, "$1=[redacted]");
  };
  try {
    rejectInheritedDataEndpoints(options.environment);
    if (!Number.isSafeInteger(options.lifetimeMs) || options.lifetimeMs < 1_000 || options.lifetimeMs > 3_600_000) {
      throw new SetupError("blocked", "The local stack lifetime must be between 1000 and 3600000 milliseconds.");
    }
    signal.throwIfAborted();
    const root = await realpath(options.repository ?? repository);
    directory = await privateDirectory(options.directory, root);
    try { lock = await open(join(directory, "active.lock"), "wx", 0o600); }
    catch { throw new SetupError("blocked", "The run directory is locked. Check its owner before removing active.lock."); }
    await lock.writeFile(String(process.pid));
    const owner = await identity(directory);
    sensitive = [owner.feedbackKey];
    for (const binding of owner.bindings ?? []) await unusedPort(new Set(), binding.port);
    const commandEnv: Record<string, string | undefined> = {
      PATH: options.environment.PATH, HOME: options.environment.HOME,
      TMPDIR: options.environment.TMPDIR, NODE_ENV: "development",
    };
    const envFile = join(directory, "compose.env");
    await writeFile(envFile, "VITE_CONVEX_URL=http://127.0.0.1:3210\n", { mode: 0o600 });
    let sequence = 0;
    async function command(executor: CommandExecutor, command: string, args: readonly string[], step: string, deadlineMs: number, env: Environment = commandEnv, commandSignal?: AbortSignal, cwd = root) {
      let outcome: CommandOutcome;
      try {
        outcome = await executor.execute({
          command, args, cwd, env, deadlineMs, signal: commandSignal,
          log: join(directory!, `${++sequence}-${step}.log`), redact,
        });
      } catch (error) { ownershipUncertain = true; throw error; }
      if (outcome.kind !== "succeeded") {
        if (outcome.kind !== "not-started" && outcome.ownership === "uncertain") ownershipUncertain = true;
        throw new SetupError(step === "compose-version" || outcome.kind === "blocked" ? "blocked" : "failed",
          `${step} did not succeed. See its private command log.`);
      }
      return outcome.stdout;
    }
    const composeArgs = ["--host", dockerHost, "compose", "--parallel", "1", "--project-name", owner.project, "--env-file", envFile, "-f", join(root, "compose.yaml")];
    const compose = (executor: CommandExecutor, args: string[], step: string, deadlineMs: number, commandSignal?: AbortSignal) =>
      command(executor, "docker", [...composeArgs, ...args], step, deadlineMs, commandEnv, commandSignal);
    const version = (await compose(options.commands.work, ["version", "--short"], "compose-version", 10_000, signal)).trim().replace(/^v/, "");
    const versionParts = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
    const [major, minor, patch] = versionParts?.slice(1, 4).map(Number) ?? [];
    if (!versionParts || major < 2 || major === 2 && (minor < 24 || minor === 24 && patch < 4)) {
      throw new SetupError("blocked", "Docker Compose 2.24.4 or newer is required for complete port replacement.");
    }
    const base = decodeCompose(await compose(options.commands.work, ["config", "--format", "json"], "base-config", 10_000, signal));
    const used = new Set<number>();
    const bindings: Binding[] = [];
    const override = ["services:"];
    for (const [name, service] of Object.entries(base.services)) {
      override.push(`  ${JSON.stringify(name)}:`, "    ports: !override");
      if (!service.ports?.length) override[override.length - 1] += " []";
      for (const item of service.ports ?? []) {
        if (!Number.isInteger(item.target) || item.protocol && item.protocol !== "tcp") throw new SetupError("blocked", "Local setup supports TCP published ports only.");
        const retained = owner.bindings?.find((binding) => binding.service === name && binding.target === item.target);
        if (owner.bindings && !retained) throw new SetupError("blocked", "Compose published ports differ from the retained identity. Retain the directory for recovery.");
        const port = retained?.port ?? await unusedPort(used);
        bindings.push({ service: name, target: item.target, port });
        override.push(`      - ${JSON.stringify({ target: item.target, published: String(port), host_ip: "127.0.0.1", protocol: "tcp" })}`);
      }
    }
    if (owner.bindings && owner.bindings.length !== bindings.length) throw new SetupError("blocked", "Compose published ports differ from the retained identity. Retain the directory for recovery.");
    const settings = hostSettings(base, bindings, owner.feedbackKey);
    const minio = override.indexOf('  "minio":');
    override.splice(minio + 1, 0, "    environment:", `      MINIO_API_CORS_ALLOW_ORIGIN: ${JSON.stringify(`${settings.PUBLIC_ORIGIN},null`)}`);
    sensitive = secrets(settings);
    await writeFile(join(directory, "identity.next.json"), JSON.stringify({ ...owner, bindings }), { mode: 0o600 });
    await rename(join(directory, "identity.next.json"), join(directory, "identity.json"));
    const overridePath = join(directory, "compose.override.yaml");
    const seed = override.indexOf('  "minio-seed":');
    override.splice(seed + 2, 0, "    environment:", `      LOCAL_PLATFORM_BROWSER_ORIGIN: ${JSON.stringify(settings.PUBLIC_ORIGIN)}`);
    const content = override.join("\n") + "\n";
    await writeFile(overridePath, content, { mode: 0o600 });
    composeArgs.push("-f", overridePath);
    const resolved = decodeCompose(await compose(options.commands.work, ["config", "--format", "json"], "resolved-config", 10_000, signal));
    const volumes = Object.values(resolved.volumes ?? {}).map((volume) => volume.name ?? "");
    if (volumes.some((name) => !name.startsWith(`${owner.project}_`))) throw new SetupError("blocked", "Compose volumes are not owned by this project.");
    const resolvedPorts = Object.entries(resolved.services).flatMap(([service, value]) => (value.ports ?? []).map((port) => ({ service, ...port })));
    if (resolvedPorts.length !== bindings.length || resolvedPorts.some((port) => port.host_ip !== "127.0.0.1"
      || !bindings.some((binding) => binding.service === port.service && binding.target === port.target && String(binding.port) === port.published))) {
      throw new SetupError("blocked", "Compose did not replace every published port with its owned loopback binding.");
    }
    const hostEnv = { ...commandEnv, ...settings };
    await writeFile(join(directory, "host-environment.json"), JSON.stringify(settings, null, 2), { mode: 0o600 });
    const check = (operation: string, deadlineMs: number) => command(options.commands.work, process.execPath,
      ["--import", "tsx", checkEntry, operation], operation, deadlineMs, hostEnv, signal, join(root, "services/tools"));
    if (await check("config", 30_000) !== "config\n") throw new SetupError("failed", "The actual runtime config parser did not confirm the host environment.");
    manifest = {
      project: owner.project, directory,
      origins: { tools: settings.PUBLIC_ORIGIN!, storage: settings.ARTIFACT_S3_ENDPOINT!,
        storageConsole: `http://127.0.0.1:${bindings.find((binding) => binding.service === "minio" && binding.target === 9001)!.port}`,
        markdownAdmin: new URL(settings.MARKDOWN_SHARE_ADMIN_ENDPOINT!).origin },
      bindings, volumes,
      prerequisites: {
        config: { kind: "passed", reason: "The actual loadPlatformConfig accepted the exact host environment." },
        storageHttp: blocked("Signed storage checks have not run."),
        publisherBrowser: blocked("A real browser must confirm signed PUT and readable ETag before Publisher journeys."),
        privateOAuth: blocked("Local placeholders start public routes. Private OAuth acceptance requires a real local Google client and subject."),
        markdownBrowser: blocked("The administration mock is not Convex. Supply a separately owned disposable local Convex backend."),
        statusPublication: blocked("No bounded local checker, canonical fixture pause state, or disabled notification contract is supplied. No monitors are started."),
      },
    };
    const publish = async () => {
      await writeFile(join(directory!, "manifest.next.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
      await rename(join(directory!, "manifest.next.json"), join(directory!, "manifest.json"));
    };
    await publish();
    down = async () => { await compose(options.commands.cleanup, ["down", "--timeout", "10"], "down", 60_000); };
    await compose(options.commands.work, ["up", "--detach", "--build", "--wait", "--wait-timeout", "90", ...dependencies], "dependencies", 600_000, signal);
    for (const service of ["postgres-migrate", "minio-seed"]) await compose(options.commands.work, ["run", "--build", "--no-deps", "--rm", service], service, 600_000, signal);
    await command(options.commands.work, "pnpm", ["--dir", "services/tools", "run", "build"], "build", 600_000, hostEnv, signal);
    const output = join(directory, "output");
    await rm(output, { recursive: true, force: true });
    await command(options.commands.work, "cp", ["-R", join(root, "services/tools/.output"), output], "copy-build", 60_000, commandEnv, signal);
    const expiresAt = Date.now() + options.lifetimeMs;
    try {
      host = options.commands.work.execute({
        command: process.execPath, args: [join(output, "server/index.mjs")], cwd: root,
        env: hostEnv, deadlineMs: options.lifetimeMs, signal, redact, log: join(directory, "host.log"),
      });
    } catch (error) { ownershipUncertain = true; throw error; }
    const exited = host.then(() => { throw new SetupError("failed", "The owned Tools host process ended before the local operation completed."); });
    void exited.catch(() => {});
    probe = check("health", 75_000);
    if (await Promise.race([probe, exited]) !== "health\n") throw new SetupError("failed", "The owned Tools host did not confirm both health routes.");
    probe = check("storage", 60_000);
    const storage = await Promise.race([probe, exited]);
    if (storage === "storage-http\n") manifest = { ...manifest, prerequisites: { ...manifest.prerequisites,
      storageHttp: { kind: "passed", reason: "Signed multipart PUT, exact-origin preflight, and ETag exposure headers passed over HTTP. Browser acceptance remains blocked." } } };
    else if (storage === "storage-blocked\n") manifest = { ...manifest, prerequisites: { ...manifest.prerequisites,
      storageHttp: blocked("The signed PUT, preflight, or exposed ETag prerequisite did not pass. Publisher journeys remain blocked.") } };
    else throw new SetupError("failed", "Storage prerequisite check returned an invalid result.");
    await publish();
    operation = use({ manifest, environment: settings, signal, expiresAt });
    await Promise.race([operation, exited]);
    result = { kind: "completed", manifest, cleanup: "not-needed" };
  } catch (error) {
    result = { kind: error instanceof SetupError ? error.kind : error instanceof VerificationBlocked ? "blocked" : "failed", manifest,
      reason: error instanceof SetupError || error instanceof VerificationBlocked ? redact(error.message) : "Local setup failed. Check the owned private logs and run directory.", cleanup: "not-needed" };
  } finally {
    stop.abort();
    if (probe) await probe.catch(() => {});
    if (operation) await operation.catch(() => {});
    if (host) {
      try {
        const outcome = await host;
        if (outcome.kind !== "succeeded" && outcome.kind !== "not-started" && outcome.ownership === "uncertain") ownershipUncertain = true;
      } catch { ownershipUncertain = true; }
    }
    if (down) {
      try {
        await down();
        result = { ...result, cleanup: "stopped" };
      }
      catch { result = { ...result, kind: "failed", cleanup: "retained", reason: "Owned Compose cleanup did not pass. Retain the run directory and use its exact project and override for recovery." }; }
    }
    if (ownershipUncertain) result = { ...result, kind: "failed", cleanup: "retained", reason: "A command could not prove process release. Retain active.lock and the run directory until process and Compose cleanup are confirmed." };
    if (lock) {
      await lock.close();
      if (result.cleanup !== "retained") {
        await rm(join(directory!, "output"), { recursive: true, force: true });
        await rm(join(directory!, "active.lock"));
      }
    }
  }
  return result;
}
