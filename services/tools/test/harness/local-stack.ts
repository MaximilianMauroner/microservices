import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandExecutor, CommandOutcome } from "./commands.ts";
import type { MinioImage } from "./minio-image.ts";
import { rejectInheritedDataEndpoints } from "./postgres.ts";
import { redactFixture, VerificationBlocked } from "./receipt.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type ComposePort = { target: number; published?: string; host_ip?: string; protocol?: string };
type ComposeMount = { type?: string; source?: string; target?: string };
type ComposeService = { environment?: Record<string, string>; ports?: ComposePort[]; volumes?: ComposeMount[]; container_name?: string; image?: string; pull_policy?: string; build?: { tags?: string[] } };
type ComposeConfig = { services: Record<string, ComposeService>; volumes?: Record<string, { name?: string; external?: boolean }> };
type Binding = Readonly<{ service: string; target: number; port: number }>;
type Identity = { version: 1; project: string; feedbackKey: string; bindings?: readonly Binding[] };
export type LocalPrerequisite = Readonly<{ kind: "passed" | "blocked"; reason: string }>;
export type LocalStackManifest = Readonly<{
  profile: "journeys";
  project: string;
  directory: string;
  origins: Readonly<{ tools: string; storage: string; storageConsole: string }>;
  startedServices: readonly ["postgres", "minio"];
  bindings: readonly Binding[];
  volumes: readonly string[];
  prerequisites: Readonly<Record<"config" | "storageHttp" | "publisherBrowser" | "privateOAuth" | "markdownBrowser" | "statusPublication", LocalPrerequisite>>;
}>;
export type IdentityStackManifest = Readonly<{
  profile: "identity-contracts";
  project: string;
  directory: string;
  origins: Readonly<{ test: string; storage: string; storageConsole: string }>;
  startedServices: readonly ["minio"];
  postgresFixture: string;
  bindings: readonly Binding[];
  volumes: readonly string[];
  prerequisites: Readonly<Record<"config" | "storageHttp", LocalPrerequisite>>;
}>;
export type VerificationStackManifest = LocalStackManifest | IdentityStackManifest;
export type VerificationStackProfile =
  | Readonly<{ kind: "journeys"; workspaceBuild?: WorkspaceToolsBuild; minio?: MinioImage }>
  | Readonly<{ kind: "identity-contracts"; postgresFixture: Readonly<{ name: string; url: string }>; minio?: MinioImage }>;
export type LocalStackOptions = Readonly<{
  directory: string;
  commands: { work: CommandExecutor; cleanup: CommandExecutor };
  environment: Environment;
  signal?: AbortSignal;
  lifetimeMs: number;
  repository?: string;
}>;

export type WorkspaceToolsBuild = Readonly<{ outputDirectory: string }>;

type IdentityStackContext = Readonly<{
  manifest: IdentityStackManifest;
  environment: Environment;
  signal: AbortSignal;
  expiresAt: number;
}>;
type JourneysProfile = Extract<VerificationStackProfile, { kind: "journeys" }>;
type IdentityProfile = Extract<VerificationStackProfile, { kind: "identity-contracts" }>;
type StackContext<P extends VerificationStackProfile> = P extends { kind: "identity-contracts" }
  ? IdentityStackContext
  : Readonly<{ manifest: LocalStackManifest; environment: Environment; signal: AbortSignal; expiresAt: number }>;
type StackUse<P extends VerificationStackProfile> = (stack: StackContext<P>) => Promise<void>;
type IdentityStackUse = StackUse<IdentityProfile>;

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const checkEntry = fileURLToPath(new URL("./local-stack-check.ts", import.meta.url));
const dockerHost = "unix:///var/run/docker.sock";
const dependencies = ["postgres", "minio"];
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
  if (!config.services || ["platform", "postgres", "minio", "postgres-migrate", "minio-seed"].some((name) => !config.services[name])) {
    throw new SetupError("blocked", "Root Compose does not contain the required local services.");
  }
  if (Object.values(config.services).some((service) => service.container_name)
    || Object.values(config.volumes ?? {}).some((volume) => volume.external)) {
    throw new SetupError("blocked", "Compose must use project-owned containers and volumes.");
  }
  return config;
}

function referencedVolumes(config: ComposeConfig, services: readonly string[]) {
  const sources = new Set(services.flatMap((name) => (config.services[name]?.volumes ?? [])
    .filter((mount) => mount.type === "volume" && mount.source).map((mount) => mount.source!)));
  return Object.entries(config.volumes ?? {})
    .filter(([name, volume]) => sources.has(name) || Boolean(volume.name && sources.has(volume.name)))
    .map(([, volume]) => volume.name ?? "");
}

function loopbackOrigin(value: string | undefined, name: string) {
  const url = new URL(value ?? "");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new SetupError("blocked", `${name} must use the owned HTTP loopback origin.`);
  }
  return url.origin;
}

function requireIdentityPostgres(fixture: IdentityProfile["postgresFixture"]) {
  let url: URL;
  try { url = new URL(fixture.url); }
  catch { throw new SetupError("blocked", "The identity contracts need the owned loopback PostgreSQL fixture."); }
  if (!/^tools-runtime-[a-f0-9-]{36}$/.test(fixture.name)
    || !["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || !url.port || url.username !== "tools_runtime" || !url.password
    || url.pathname !== "/tools_runtime_test" || url.search || url.hash) {
    throw new SetupError("blocked", "The identity contracts need the owned loopback PostgreSQL fixture.");
  }
  return fixture.url;
}

function hostSettings(base: ComposeConfig, bindings: LocalStackManifest["bindings"], key: string,
  database: Readonly<{ url?: string; password?: string }> = {}): Environment {
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
    DATABASE_URL: database.url ?? `postgres://local:${database.password ?? "local"}@127.0.0.1:${port("postgres", 5432)}/postgres`,
    TOOLS_S3_ENDPOINT: `http://127.0.0.1:${port("minio", 9000)}`,
    ARTIFACT_S3_ENDPOINT: `http://127.0.0.1:${port("minio", 9000)}`,
    FEEDBACK_ENCRYPTION_KEY: key,
    // A local stack keeps one retained key. Bodyshop derives its own from it, so restarts read earlier data.
    BODYSHOP_ENCRYPTION_KEY: createHash("sha256").update(`bodyshop:${key}`).digest("base64url"),
  };
  for (const name of ["PUBLIC_ORIGIN", "TOOLS_S3_ENDPOINT", "ARTIFACT_S3_ENDPOINT"]) loopbackOrigin(env[name], name);
  return env;
}

function secrets(env: Environment): string[] {
  return Object.entries(env).filter(([name, value]) => value && /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(name)).map(([, value]) => value!).sort((a, b) => b.length - a.length);
}

async function commandFailureExcerpt(path: string, redact: (text: string) => string, env: Environment) {
  try {
    const size = (await stat(path)).size;
    const length = Math.min(size, 8_192);
    const handle = await open(path, "r");
    let excerpt: string;
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      excerpt = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
    if (size > length) {
      const boundary = excerpt.indexOf("\n");
      excerpt = boundary < 0 ? "" : excerpt.slice(boundary + 1);
    }
    excerpt = excerpt.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
    excerpt = redactFixture(redact(excerpt), env)
      .replace(/\b(Bearer\s+)[^\s,;]+/gi, "$1[redacted]")
      .replace(/\b(password|secret|token|api[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]");
    return excerpt.split(/\r?\n/).filter((line) => line.trim()).slice(-12).join("\n").slice(-1_500) || undefined;
  } catch {
    return undefined;
  }
}

export type LocalStackResult = Readonly<{
  kind: "completed" | "blocked" | "failed";
  manifest?: VerificationStackManifest;
  reason?: string;
  cleanup: "not-needed" | "stopped" | "disposed" | "retained";
}>;

type LocalStackUse = (stack: Readonly<{ manifest: LocalStackManifest; environment: Environment; signal: AbortSignal; expiresAt: number }>) => Promise<void>;

export function withLocalStack(options: LocalStackOptions, use: LocalStackUse): Promise<LocalStackResult> {
  return runLocalStack(options, use, "persistent", { kind: "journeys" });
}

export function withVerificationStack(
  options: Omit<LocalStackOptions, "directory">,
  use: LocalStackUse,
  profile?: JourneysProfile,
): Promise<LocalStackResult & Readonly<{ manifest?: LocalStackManifest; directory: string }>>;
export function withVerificationStack(
  options: Omit<LocalStackOptions, "directory">,
  use: IdentityStackUse,
  profile: IdentityProfile,
): Promise<LocalStackResult & Readonly<{ manifest?: IdentityStackManifest; directory: string }>>;
export async function withVerificationStack(
  options: Omit<LocalStackOptions, "directory">,
  use: LocalStackUse | IdentityStackUse,
  profile: VerificationStackProfile = { kind: "journeys" },
) {
  if (profile.kind === "identity-contracts") requireIdentityPostgres(profile.postgresFixture);
  if (profile.kind === "journeys" && profile.workspaceBuild) {
    const root = await realpath(options.repository ?? repository);
    const toolsOutput = join(root, "services/tools/.output");
    if (resolve(profile.workspaceBuild.outputDirectory) !== toolsOutput) {
      throw new SetupError("blocked", "Only the verified Tools workspace build can be reused by a verification stack.");
    }
    const serverEntry = await stat(join(toolsOutput, "server/index.mjs")).catch(() => undefined);
    if (!serverEntry?.isFile()) throw new SetupError("failed", "The verified Tools workspace build is missing its server entry.");
  }
  const directory = await mkdtemp(join(tmpdir(), "tools-identity-"));
  const result = profile.kind === "identity-contracts"
    ? await runLocalStack({ ...options, directory }, use as IdentityStackUse, "verification", profile)
    : await runLocalStack({ ...options, directory }, use as LocalStackUse, "verification", profile);
  return { ...result, directory };
}

async function runLocalStack<P extends VerificationStackProfile>(
  options: LocalStackOptions,
  use: StackUse<P>,
  lifetime: "persistent" | "verification",
  profile: P,
): Promise<LocalStackResult> {
  let directory: string | undefined;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let manifest: VerificationStackManifest | undefined;
  let down: (() => Promise<void>) | undefined;
  let host: Promise<CommandOutcome> | undefined;
  let exited: Promise<never> | undefined;
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
    const toolsOutput = join(root, "services/tools/.output");
    directory = await privateDirectory(options.directory, root);
    try { lock = await open(join(directory, "active.lock"), "wx", 0o600); }
    catch { throw new SetupError("blocked", "The run directory is locked. Check its owner before removing active.lock."); }
    await lock.writeFile(String(process.pid));
    const owner = await identity(directory);
    sensitive = [owner.feedbackKey];
    const databasePassword = lifetime === "verification" && profile.kind === "journeys" ? randomBytes(32).toString("hex") : undefined;
    if (databasePassword) sensitive.push(databasePassword);
    for (const binding of owner.bindings ?? []) await unusedPort(new Set(), binding.port);
    const commandEnv: Record<string, string | undefined> = {
      PATH: options.environment.PATH?.split(delimiter).map((entry) => isAbsolute(entry) ? entry : `${process.cwd()}${sep}${entry}`).join(delimiter), HOME: options.environment.HOME,
      TMPDIR: options.environment.TMPDIR, NODE_ENV: "development",
    };
    const envFile = join(directory, "compose.env");
    await writeFile(envFile, "LOCAL_BUILD_INPUT=local-build\n", { mode: 0o600 });
    const composePath = join(directory, "compose.yaml");
    await writeFile(composePath, await readFile(join(root, "compose.yaml")), { mode: 0o600 });
    let sequence = 0;
    async function command(executor: CommandExecutor, command: string, args: readonly string[], step: string, deadlineMs: number, env: Environment = commandEnv, commandSignal?: AbortSignal, cwd = root) {
      const log = join(directory!, `${++sequence}-${step}.log`);
      let outcome: CommandOutcome;
      try {
        outcome = await executor.execute({
          command, args, cwd, env, deadlineMs, signal: commandSignal,
          log, redact,
        });
      } catch (error) { ownershipUncertain = true; throw error; }
      if (outcome.kind !== "succeeded") {
        if (outcome.kind !== "not-started" && outcome.ownership === "uncertain") ownershipUncertain = true;
        let message = `${step} did not succeed. See its private command log.`;
        if (step === "postgres-migrate" && outcome.kind !== "not-started" && outcome.log.kind === "written") {
          const excerpt = await commandFailureExcerpt(outcome.log.path, redact, env);
          if (excerpt) message += `\nPostgreSQL migration output (redacted):\n${excerpt}`;
        }
        throw new SetupError(step === "compose-version" || outcome.kind === "blocked" ? "blocked" : "failed",
          message);
      }
      return outcome.stdout;
    }
    const composeArgs = ["--host", dockerHost, "compose", "--parallel", "1", "--project-name", owner.project, "--project-directory", root, "--env-file", envFile, "-f", composePath];
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
    const databaseUrl = profile.kind === "identity-contracts" ? requireIdentityPostgres(profile.postgresFixture) : undefined;
    const settings = hostSettings(base, bindings, owner.feedbackKey, { password: databasePassword, url: databaseUrl });
    if (databasePassword) {
      const databaseUrl = `postgres://local:${databasePassword}@postgres:5432/postgres`;
      const databaseEnvironment = {
        postgres: { POSTGRES_PASSWORD: databasePassword },
        "postgres-migrate": { DATABASE_URL: databaseUrl },
        platform: { DATABASE_URL: databaseUrl },
      };
      for (const [service, environment] of Object.entries(databaseEnvironment)) {
        override.splice(override.indexOf(`  ${JSON.stringify(service)}:`) + 1, 0, "    environment:",
          ...Object.entries(environment).map(([name, value]) => `      ${name}: ${JSON.stringify(value)}`));
      }
    }
    const minio = override.indexOf('  "minio":');
    const minioImage = lifetime === "verification" ? profile.minio : undefined;
    if (minioImage) {
      override.splice(minio + 1, 0, "    build: !reset null", `    image: ${JSON.stringify(minioImage.reference)}`, `    pull_policy: ${JSON.stringify("never")}`);
    }
    override.splice(minio + 1 + (minioImage ? 3 : 0), 0, "    environment:", `      MINIO_API_CORS_ALLOW_ORIGIN: ${JSON.stringify(`${settings.PUBLIC_ORIGIN},null`)}`);
    sensitive = secrets({ ...settings, POSTGRES_PASSWORD: databasePassword });
    await writeFile(join(directory, "identity.next.json"), JSON.stringify({ ...owner, bindings }), { mode: 0o600 });
    await rename(join(directory, "identity.next.json"), join(directory, "identity.json"));
    const overridePath = join(directory, "compose.override.yaml");
    const seed = override.indexOf('  "minio-seed":');
    override.splice(seed + 2, 0, "    environment:", `      LOCAL_PLATFORM_BROWSER_ORIGIN: ${JSON.stringify(settings.PUBLIC_ORIGIN)}`);
    const content = override.join("\n") + "\n";
    await writeFile(overridePath, content, { mode: 0o600 });
    composeArgs.push("-f", overridePath);
    const resolved = decodeCompose(await compose(options.commands.work, ["config", "--format", "json"], "resolved-config", 10_000, signal));
    if (lifetime === "verification" && Object.values(resolved.services).some((service) => service.build
      ? service.image !== undefined || Boolean(service.build.tags?.length) : !service.image?.split("/").at(-1)?.includes(":"))) {
      throw new SetupError("blocked", "Verification requires project-generated build tags and explicitly tagged dependency images.");
    }
    if (minioImage && (resolved.services.minio?.image !== minioImage.reference || resolved.services.minio.build
      || resolved.services.minio.pull_policy !== "never")) {
      throw new SetupError("blocked", "Compose did not select the verified MinIO image without a rebuild or pull.");
    }
    const services = profile.kind === "identity-contracts" ? ["minio"] : dependencies;
    const volumes = referencedVolumes(resolved, services);
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
    const storageConsole = `http://127.0.0.1:${bindings.find((binding) => binding.service === "minio" && binding.target === 9001)!.port}`;
    const configPrerequisite = { kind: "passed" as const, reason: "The actual loadPlatformConfig accepted the exact host environment." };
    const storagePrerequisite = blocked("Signed storage checks have not run.");
    manifest = profile.kind === "identity-contracts"
      ? {
        profile: "identity-contracts", project: owner.project, directory,
        origins: { test: settings.PUBLIC_ORIGIN!, storage: settings.ARTIFACT_S3_ENDPOINT!, storageConsole },
        startedServices: ["minio"], postgresFixture: profile.postgresFixture.name, bindings, volumes,
        prerequisites: { config: configPrerequisite, storageHttp: storagePrerequisite },
      }
      : {
        profile: "journeys", project: owner.project, directory,
        origins: { tools: settings.PUBLIC_ORIGIN!, storage: settings.ARTIFACT_S3_ENDPOINT!, storageConsole },
        startedServices: ["postgres", "minio"], bindings, volumes,
        prerequisites: {
          config: configPrerequisite,
          storageHttp: storagePrerequisite,
          publisherBrowser: blocked("A real browser must confirm signed PUT and readable ETag before Publisher journeys."),
          privateOAuth: blocked("Local placeholders start public routes. Private OAuth acceptance requires a real local Google client and subject."),
          markdownBrowser: blocked("The public document backend check has not run."),
          statusPublication: blocked("No bounded local checker, canonical fixture pause state, or disabled notification contract is supplied. No monitors are started."),
        },
      };
    const publish = async () => {
      await writeFile(join(directory!, "manifest.next.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
      await rename(join(directory!, "manifest.next.json"), join(directory!, "manifest.json"));
    };
    await publish();
    down = async () => {
      await compose(options.commands.cleanup, ["down", "--timeout", "10"], "down", 60_000);
      if (lifetime === "verification" && result.kind === "completed" && !options.signal?.aborted && !ownershipUncertain
        && manifest?.prerequisites.storageHttp.kind === "passed") {
        const containers = await command(options.commands.cleanup, "docker", ["--host", dockerHost, "ps", "--all", "--quiet",
          "--filter", `label=com.docker.compose.project=${owner.project}`], "confirm-stopped", 10_000);
        if (containers.trim()) throw new Error("Owned project containers remain after shutdown.");
        if (options.signal?.aborted) return;
        await compose(options.commands.cleanup, ["down", "--timeout", "10", "--volumes", "--rmi", "local"], "dispose", 60_000);
        const remainingVolumes = await command(options.commands.cleanup, "docker", ["--host", dockerHost, "volume", "ls", "--quiet",
          "--filter", `name=${owner.project}_`], "confirm-volumes-removed", 10_000);
        const remainingImages = await command(options.commands.cleanup, "docker", ["--host", dockerHost, "image", "ls", "--quiet",
          "--filter", `reference=${owner.project}-*`], "confirm-images-removed", 10_000);
        if (remainingVolumes.trim() || remainingImages.trim()) throw new Error("Owned project volumes or image tags remain after disposal.");
        result = { ...result, cleanup: "disposed" };
      }
    };
    const output = join(directory, "output");
    const workspaceBuild = profile.kind === "journeys" ? profile.workspaceBuild : undefined;
    if (workspaceBuild) {
      await command(options.commands.work, "cp", ["-R", toolsOutput, output], "copy-build", 60_000, commandEnv, signal);
    }
    await compose(options.commands.work, ["up", "--detach", ...(minioImage ? [] : ["--build"]), "--wait", "--wait-timeout", "90", ...services], "dependencies", 600_000, signal);
    const minioReady = async () => {
      if (await check("minio-ready", 35_000) !== "minio-ready\n") throw new SetupError("failed", "MinIO did not confirm readiness.");
    };
    if (lifetime === "verification") {
      const toolsCwd = join(root, "services/tools");
      const seed = async () => {
        await minioReady();
        return command(options.commands.work, process.execPath,
          ["--import", "tsx", "products/status/local-seed.ts"], "minio-seed", 600_000,
          { ...hostEnv, LOCAL_PLATFORM_BROWSER_ORIGIN: hostEnv.PUBLIC_ORIGIN, SEED_RETRY_ATTEMPTS: "30" }, signal, toolsCwd);
      };
      if (profile.kind === "identity-contracts") await seed();
      else {
        const setup = await Promise.allSettled([
          command(options.commands.work, process.execPath,
            ["--import", "tsx", "platform/database/push-postgres.ts", "development"], "postgres-migrate", 600_000,
            { ...hostEnv, TOOLS_ENVIRONMENT: "development", TOOLS_DEVELOPMENT_SCHEMA_PUSH_CONFIRM: "tools-platform-development" }, signal, toolsCwd),
          seed(),
        ]);
        const failed = setup.find((item): item is PromiseRejectedResult => item.status === "rejected");
        if (failed) throw failed.reason;
      }
    } else {
      for (const service of ["postgres-migrate", "minio-seed"]) {
        if (service === "minio-seed") await minioReady();
        await compose(options.commands.work, ["run", "--build", "--no-deps", "--rm", service], service, 600_000, signal);
      }
    }
    if (profile.kind === "journeys" && !workspaceBuild) {
      await rm(output, { recursive: true, force: true });
      await command(options.commands.work, "pnpm", ["--dir", "services/tools", "run", "build"], "build", 600_000, hostEnv, signal);
      await command(options.commands.work, "cp", ["-R", toolsOutput, output], "copy-build", 60_000, commandEnv, signal);
    }
    const expiresAt = Date.now() + options.lifetimeMs;
    if (profile.kind === "journeys") {
      try {
        host = options.commands.work.execute({
          command: process.execPath, args: [join(output, "server/index.mjs")], cwd: root,
          env: hostEnv, deadlineMs: options.lifetimeMs, signal, redact, log: join(directory, "host.log"),
        });
      } catch (error) { ownershipUncertain = true; throw error; }
      exited = host.then(() => { throw new SetupError("failed", "The owned Tools host process ended before the local operation completed."); });
      void exited.catch(() => {});
      probe = check("health", 75_000);
      if (await Promise.race([probe, exited]) !== "health\n") throw new SetupError("failed", "The owned Tools host did not confirm both health routes.");
      probe = check("markdown", 30_000);
      if (await Promise.race([probe, exited]) !== "markdown-http\n") throw new SetupError("failed", "The public document backend did not confirm creation and content retrieval.");
      const fullManifest = manifest as LocalStackManifest;
      manifest = { ...fullManifest, prerequisites: { ...fullManifest.prerequisites,
        markdownBrowser: { kind: "passed", reason: "Public document creation and content retrieval passed over HTTP with local PostgreSQL. Browser acceptance has not run." } } };
    }
    probe = check("storage", 60_000);
    const storage = exited ? await Promise.race([probe, exited]) : await probe;
    const storageHttp = storage === "storage-http\n"
      ? { kind: "passed" as const, reason: "Signed multipart PUT, exact-origin preflight, and ETag exposure headers passed over HTTP." }
      : storage === "storage-blocked\n"
        ? blocked("The signed PUT, preflight, or exposed ETag prerequisite did not pass.")
        : undefined;
    if (storageHttp && manifest?.profile === "journeys") manifest = { ...manifest, prerequisites: { ...manifest.prerequisites, storageHttp } };
    else if (storageHttp && manifest?.profile === "identity-contracts") manifest = { ...manifest, prerequisites: { ...manifest.prerequisites, storageHttp } };
    else throw new SetupError("failed", "Storage prerequisite check returned an invalid result.");
    await publish();
    operation = use({ manifest: manifest as StackContext<P>["manifest"], environment: settings, signal, expiresAt } as StackContext<P>);
    if (exited) await Promise.race([operation, exited]);
    else await operation;
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
        if (result.cleanup !== "disposed") result = { ...result, cleanup: "stopped" };
      }
      catch { result = { ...result, kind: "failed", cleanup: "retained", reason: "Owned Compose cleanup did not pass. Retain the run directory and use its exact project and override for recovery." }; }
    }
    if (ownershipUncertain) result = { ...result, kind: "failed", cleanup: "retained", reason: "A command could not prove process release. Retain active.lock and the run directory until process and Compose cleanup are confirmed." };
    if (lock) await lock.close();
    if (lifetime === "verification" && options.signal?.aborted && result.cleanup === "disposed") {
      result = { ...result, kind: "failed", cleanup: "retained",
        reason: "Verification was cancelled during disposal. Project resources may already be removed. Retain the private run directory for inspection." };
    }
    if (lifetime === "verification" && result.cleanup !== "disposed") {
      result = { ...result, kind: result.kind === "completed" ? "failed" : result.kind, cleanup: "retained",
        reason: result.reason ?? "Verification did not pass. Retain its project resources and private run directory for recovery." };
    }
    if (lock) {
      if (result.cleanup === "disposed") {
        try { await rm(directory!, { recursive: true }); }
        catch { result = { ...result, kind: "failed", cleanup: "retained", reason: "Project disposal passed, but private directory removal did not pass. Retain the remaining files for inspection." }; }
      } else if (result.cleanup !== "retained") {
        await rm(join(directory!, "output"), { recursive: true, force: true });
        await rm(join(directory!, "active.lock"));
      }
    }
  }
  return result;
}
