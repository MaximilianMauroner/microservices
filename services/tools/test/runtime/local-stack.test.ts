import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadPlatformConfig } from "../../src/config.ts";
import { createFeedbackEncryption, parseFeedbackEncryptionKey } from "../../feedback/encryption.ts";
import type { CommandExecutor, CommandOutcome, CommandSpec } from "./commands.ts";
import { withOwnedCommands } from "./commands.ts";
import { withLocalStack, withVerificationStack, type LocalStackOptions } from "./local-stack.ts";

const artifactRoot = fileURLToPath(new URL("../../../../.agents/artifacts/r2-local-stack-2026-10-17/", import.meta.url));
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

const platform = {
  NODE_ENV: "development", PORT: "3000", PUBLIC_ORIGIN: "http://localhost:3000", PLATFORM_READ_ONLY: "false",
  DATABASE_URL: "postgres://local:local@postgres:5432/postgres",
  GOOGLE_CLIENT_ID: "local-client", GOOGLE_CLIENT_SECRET: "local-secret", AUTH_ALLOWED_GOOGLE_SUBJECT: "local-subject",
  BETTER_AUTH_SECRET: "local-auth-secret-00000000000000000000", TOWER_HEARTBEAT_TOKEN: "local-heartbeat-0000000000000000000000",
  UPLOAD_TOKEN: "local-upload-0000000000000000000000000", MARKDOWN_SHARE_ADMIN_TOKEN: "local-markdown-00000000000000000000000",
  MARKDOWN_SHARE_ADMIN_ENDPOINT: "http://markdown-mock:8787/admin/documents", VITE_CONVEX_URL: "http://127.0.0.1:3210",
  TOOLS_S3_BUCKET: "tools", TOOLS_S3_ENDPOINT: "http://minio:9000", TOOLS_S3_REGION: "us-east-1",
  TOOLS_S3_ACCESS_KEY_ID: "local-minio", TOOLS_S3_SECRET_ACCESS_KEY: "local-minio-password", TOOLS_S3_FORCE_PATH_STYLE: "true",
  ARTIFACT_S3_BUCKET: "artifacts", ARTIFACT_S3_ENDPOINT: "http://minio:9000", ARTIFACT_S3_REGION: "us-east-1",
  ARTIFACT_S3_ACCESS_KEY_ID: "local-minio", ARTIFACT_S3_SECRET_ACCESS_KEY: "local-minio-password", ARTIFACT_S3_FORCE_PATH_STYLE: "true",
};

function failed(spec: CommandSpec): Extract<CommandOutcome, { kind: "failed" | "blocked" }> {
  return { kind: "failed", termination: { kind: "natural" }, exit: { kind: "exited", code: 1 }, escalation: "none",
    ownership: "released", log: { kind: "written", path: spec.log }, reasons: ["test failure"] };
}

async function fixture() {
  await mkdir(artifactRoot, { recursive: true });
  const directory = await mkdtemp(join(artifactRoot, "fixture-"));
  directories.push(directory);
  const root = join(directory, "checkout");
  await mkdir(root);
  const calls: CommandSpec[] = [];
  let response: (spec: CommandSpec) => Promise<CommandOutcome | undefined> = async () => undefined;
  const base: {
    services: Record<string, { ports?: { target: number; published: string; host_ip?: string; protocol?: string }[]; environment?: Record<string, string>; build?: { context?: string; args?: Record<string, string>; tags?: string[] }; image?: string }>;
    volumes: Record<string, { name?: string; external?: boolean }>;
  } = {
    services: {
      postgres: { image: "postgres:16-alpine", ports: [{ target: 5432, published: "5432" }] },
      minio: { build: {}, ports: [{ target: 9000, published: "9000" }, { target: 9001, published: "9001" }] },
      "markdown-mock": { build: {}, ports: [{ target: 8787, published: "8787" }] },
      "postgres-migrate": { build: {} }, "minio-seed": { build: {} },
      platform: { build: {}, environment: platform, ports: [{ target: 3000, published: "3000" }] },
    },
    volumes: { "postgres-data": {}, "minio-data": {} },
  };
  await writeFile(join(root, "compose.yaml"), JSON.stringify(base));
  const execute: CommandExecutor = { async execute(spec) {
    calls.push(spec);
    await writeFile(spec.log, "fixture command log\n");
    const supplied = await response(spec);
    if (supplied) return supplied;
    let stdout = "";
    if (spec.args.includes("config") && spec.command === "docker") {
      const config = JSON.parse(await readFile(spec.args[spec.args.indexOf("-f") + 1]!, "utf8")) as typeof base;
      if (spec.args.filter((arg) => arg === "-f").length === 2) {
        const override = await readFile(spec.args[spec.args.lastIndexOf("-f") + 1]!, "utf8");
        let service = "";
        for (const line of override.split("\n")) {
          if (/^  "/.test(line)) {
            service = JSON.parse(line.trim().slice(0, -1)) as string;
            config.services[service]!.ports = [];
          }
          if (/^      - \{/.test(line)) {
            config.services[service]!.ports!.push(JSON.parse(line.trim().slice(2)));
          }
        }
        const project = spec.args[spec.args.indexOf("--project-name") + 1]!;
        config.volumes = Object.fromEntries(Object.entries(config.volumes).map(([name, volume]) => [name, { ...volume, name: volume.name ?? `${project}_${name}` }]));
      }
      stdout = JSON.stringify(config);
    } else if (spec.args.includes("version")) stdout = "2.24.4\n";
    else if (spec.args.at(-1) === "config") {
      loadPlatformConfig(spec.env);
      stdout = "config\n";
    } else if (spec.args.at(-1) === "health") stdout = "health\n";
    else if (spec.args.at(-1) === "storage") stdout = "storage-http\n";
    else if (spec.args[0]?.endsWith("index.mjs")) {
      await new Promise<void>((resolve) => {
        if (spec.signal?.aborted) resolve();
        else spec.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return failed(spec);
    }
    return { kind: "succeeded", stdout, log: spec.log };
  } };
  const options: LocalStackOptions = { directory: join(directory, "private"), repository: root,
    environment: { PATH: process.env.PATH, FEEDBACK_ENCRYPTION_KEY: "ignored-shell-key", GOOGLE_CLIENT_SECRET: "ignored-shell-oauth" },
    commands: { work: execute, cleanup: execute }, lifetimeMs: 30_000 };
  return { directory, options, calls, base, respond(handler: typeof response) { response = handler; } };
}

async function retainedFiles(directory: string) {
  const entries = await Promise.all((await readdir(directory)).map(async (name) => [name, await readFile(join(directory, name), "utf8")]));
  return Object.fromEntries(entries);
}

async function expectLocked(setup: Awaited<ReturnType<typeof fixture>>) {
  expect(await readFile(join(setup.options.directory, "active.lock"), "utf8")).toBe(String(process.pid));
  const files = await retainedFiles(setup.options.directory);
  const count = setup.calls.length;
  const next = await withLocalStack(setup.options, async () => { throw new Error("must not run"); });
  expect(next).toMatchObject({ kind: "blocked", reason: expect.stringContaining("locked") });
  expect(setup.calls).toHaveLength(count);
  expect(await retainedFiles(setup.options.directory)).toEqual(files);
}

describe("owned local stack", () => {
  it.each(["persistent", "verification"])("keeps %s Compose resources fixed when the checkout changes after validation and before disposal", async (lifetime) => {
    const setup = await fixture();
    setup.base.services.minio!.build = { context: ".", args: { RAW: "${VITE_CONVEX_URL:-http://localhost:3210}", LITERAL: "$$UNCHANGED" } };
    const source = join(setup.options.repository!, "compose.yaml");
    const original = JSON.stringify(setup.base, null, 2) + "\n";
    await writeFile(source, original);
    const selected: { volumes: string[]; images: string[] }[] = [];
    const mutations: string[] = [];
    const mutate = async (stage: string) => {
      const changed = structuredClone(setup.base);
      changed.volumes["postgres-data"]!.name = `another-stack-${stage}-data`;
      changed.services.minio!.image = `another-stack-${stage}-minio:local`;
      await writeFile(source, JSON.stringify(changed));
      mutations.push(stage);
    };
    setup.respond(async (spec) => {
      if (spec.log.endsWith("-config.log") && spec.command !== "docker") await mutate("after-validation");
      if (spec.args.includes("ps")) await mutate("before-disposal");
      if (spec.command !== "docker" || !spec.args.includes("compose")) return undefined;
      const path = spec.args[spec.args.indexOf("-f") + 1]!;
      const raw = await readFile(path, "utf8");
      const config = JSON.parse(raw) as typeof setup.base;
      const project = spec.args[spec.args.indexOf("--project-name") + 1]!;
      const projectDirectory = spec.args[spec.args.indexOf("--project-directory") + 1]!;
      expect(dirname(path)).toBe(dirname(spec.log));
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(raw).toBe(original);
      expect(resolve(projectDirectory, config.services.minio!.build!.context!)).toBe(setup.options.repository);
      expect(await readFile(spec.args[spec.args.indexOf("--env-file") + 1]!, "utf8")).toBe("VITE_CONVEX_URL=http://127.0.0.1:3210\n");
      expect(spec.env?.VITE_CONVEX_URL).toBeUndefined();
      if (spec.args.includes("up") || spec.args.includes("run") || spec.args.includes("down")) selected.push({
        volumes: Object.entries(config.volumes).map(([name, volume]) => volume.name ?? `${project}_${name}`),
        images: Object.entries(config.services).filter(([, service]) => service.build).map(([name, service]) => service.image ?? `${project}-${name}`),
      });
      return undefined;
    });
    const use = async ({ manifest }: Parameters<Parameters<typeof withLocalStack>[1]>[0]) => {
      if (lifetime === "verification") directories.push(manifest.directory);
      expect(mutations).toEqual(["after-validation"]);
      expect(manifest.volumes).toEqual([`${manifest.project}_postgres-data`, `${manifest.project}_minio-data`]);
      await mutate("before-stop");
    };
    const result = lifetime === "verification"
      ? await withVerificationStack(setup.options, use)
      : await withLocalStack(setup.options, use);
    expect(result).toMatchObject({ kind: "completed", cleanup: lifetime === "verification" ? "disposed" : "stopped" });
    expect(mutations).toEqual(lifetime === "verification" ? ["after-validation", "before-stop", "before-disposal"] : ["after-validation", "before-stop"]);
    expect(selected).toHaveLength(lifetime === "verification" ? 5 : 4);
    for (const resources of selected) {
      expect(resources.volumes).toEqual(result.manifest!.volumes);
      expect(resources.images).toEqual(["minio", "markdown-mock", "postgres-migrate", "minio-seed", "platform"].map((name) => `${result.manifest!.project}-${name}`));
    }
    expect(await readFile(source, "utf8")).toContain("another-stack-");
  });

  it("disposes only a fresh verification project after the host and normal stop release it", async () => {
    const setup = await fixture();
    const persistent = await withLocalStack(setup.options, async () => {});
    const retained = await retainedFiles(setup.options.directory);
    setup.calls.length = 0;
    let hostReleased = false;
    setup.respond(async (spec) => {
      if (spec.args[0]?.endsWith("index.mjs")) {
        await new Promise<void>((resolve) => spec.signal!.addEventListener("abort", () => resolve(), { once: true }));
        hostReleased = true;
        return failed(spec);
      }
      if (spec.args.includes("down")) expect(hostReleased).toBe(true);
      return undefined;
    });
    const result = await withVerificationStack(setup.options, async ({ manifest }) => {
      directories.push(manifest.directory);
      expect(manifest.project).not.toBe(persistent.manifest!.project);
    });
    expect(result).toMatchObject({ kind: "completed", cleanup: "disposed" });
    await expect(stat(result.directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await retainedFiles(setup.options.directory)).toEqual(retained);
    const docker = setup.calls.filter((spec) => spec.command === "docker");
    const stops = docker.filter((spec) => spec.args.includes("down"));
    expect(stops.map((spec) => spec.args.slice(spec.args.indexOf("down")))).toEqual([
      ["down", "--timeout", "10"], ["down", "--timeout", "10", "--volumes", "--rmi", "local"],
    ]);
    expect(stops.every((spec) => spec.signal === undefined)).toBe(true);
    expect(docker.every((spec) => spec.args[1] === "unix:///var/run/docker.sock")).toBe(true);
    expect(docker.filter((spec) => spec.args.includes("compose"))
      .every((spec) => spec.args[spec.args.indexOf("--project-name") + 1] === result.manifest!.project)).toBe(true);
    expect(docker.filter((spec) => !spec.args.includes("compose"))
      .every((spec) => spec.args.at(-1)?.includes(result.manifest!.project))).toBe(true);
    expect(stops.every((spec) => spec.args[spec.args.lastIndexOf("-f") + 1] === join(result.directory, "compose.override.yaml"))).toBe(true);
  });

  it.each(["callback", "storage", "cancel", "cancel-before-disposal", "cancel-during-disposal", "host-ownership", "down", "dispose",
    "containers-remain", "volumes-remain", "images-remain", "inspection-fails"])("preserves verification recovery files after %s failure", async (failure) => {
    const setup = await fixture();
    const controller = new AbortController();
    setup.respond(async (spec) => {
      if (failure === "storage" && spec.args.at(-1) === "storage") return { kind: "succeeded", stdout: "storage-blocked\n", log: spec.log };
      if (failure === "cancel-before-disposal" && spec.args.includes("ps")) controller.abort();
      if (failure === "cancel-during-disposal" && spec.args.includes("--volumes")) controller.abort();
      if (failure === "containers-remain" && spec.args.includes("ps")
        || failure === "volumes-remain" && spec.args.includes("volume")
        || failure === "images-remain" && spec.args.includes("image")) return { kind: "succeeded", stdout: "remaining-resource\n", log: spec.log };
      if (failure === "inspection-fails" && spec.args.includes("image")) return failed(spec);
      if (failure === "host-ownership" && spec.args[0]?.endsWith("index.mjs")) {
        await new Promise<void>((resolve) => spec.signal!.addEventListener("abort", () => resolve(), { once: true }));
        return { ...failed(spec), ownership: "uncertain" };
      }
      if (failure === "down" && spec.args.includes("down") || failure === "dispose" && spec.args.includes("--volumes")) return failed(spec);
      return undefined;
    });
    const result = await withVerificationStack({ ...setup.options, signal: controller.signal }, async ({ manifest }) => {
      directories.push(manifest.directory);
      if (failure === "callback") throw new Error("identity assertion failed");
      if (failure === "cancel") controller.abort();
    });
    expect(result).toMatchObject({ kind: "failed", cleanup: "retained" });
    expect(await readFile(join(result.directory, "identity.json"), "utf8")).toContain("feedbackKey");
    expect(await readFile(join(result.directory, "active.lock"), "utf8")).toBe(String(process.pid));
    expect(JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8")).project).toBe(result.manifest!.project);
    expect(setup.calls.filter((spec) => spec.args.includes("--volumes"))).toHaveLength(
      ["dispose", "cancel-during-disposal", "volumes-remain", "images-remain", "inspection-fails"].includes(failure) ? 1 : 0);
  });

  it("reports a failed directory removal and retains recovery files after resource disposal", async () => {
    const setup = await fixture();
    setup.respond(async (spec) => {
      if (spec.args.includes("image") && spec.args.includes("ls")) await chmod(dirname(spec.log), 0o500);
      return undefined;
    });
    let directory: string | undefined;
    try {
      const result = await withVerificationStack(setup.options, async ({ manifest }) => {
        directory = manifest.directory;
        directories.push(directory);
      });
      expect(result).toMatchObject({ kind: "failed", cleanup: "retained", reason: expect.stringContaining("directory removal") });
      expect(await readFile(join(result.directory, "active.lock"), "utf8")).toBe(String(process.pid));
      expect(await readFile(join(result.directory, "identity.json"), "utf8")).toContain("feedbackKey");
    } finally {
      if (directory) await chmod(directory, 0o700);
    }
  });

  it.each(["custom-build-tag", "extra-build-tag", "untagged-dependency", "external-volume", "foreign-volume"])("rejects %s before it starts a verification project", async (failure) => {
    const setup = await fixture();
    if (failure === "custom-build-tag") setup.base.services.minio!.image = "someone-elses-minio:local";
    if (failure === "extra-build-tag") setup.base.services.minio!.build = { tags: ["someone-elses-minio:local"] };
    if (failure === "untagged-dependency") setup.base.services.postgres!.image = "postgres";
    if (failure === "external-volume") setup.base.volumes["postgres-data"]!.external = true;
    await writeFile(join(setup.options.repository!, "compose.yaml"), JSON.stringify(setup.base));
    if (failure === "foreign-volume") setup.respond(async (spec) => {
      if (spec.log.endsWith("resolved-config.log")) return { kind: "succeeded", stdout: JSON.stringify({ ...setup.base, volumes: { data: { name: "someone-elses-data" } } }), log: spec.log };
      return undefined;
    });
    const result = await withVerificationStack(setup.options, async () => { throw new Error("must not run"); });
    directories.push(result.directory);
    expect(result).toMatchObject({ kind: "blocked", cleanup: "retained" });
    expect(setup.calls.some((spec) => spec.args.includes("up") || spec.args.includes("down"))).toBe(false);
  });

  it("allows the owned Tools and sandbox download origins without a wildcard", async () => {
    const setup = await fixture();
    const result = await withLocalStack(setup.options, async ({ manifest }) => {
      const override = await readFile(join(setup.options.directory, "compose.override.yaml"), "utf8");
      expect(override).toContain(`MINIO_API_CORS_ALLOW_ORIGIN: ${JSON.stringify(`${manifest.origins.tools},null`)}`);
      expect(override).not.toContain('MINIO_API_CORS_ALLOW_ORIGIN: "*"');
    });
    expect(result).toMatchObject({ kind: "completed", cleanup: "stopped" });
  });

  it("runs the host from a private copy of the build so a later checkout build cannot remove its files", async () => {
    const setup = await fixture();
    setup.respond(async (spec) => { if (spec.command === "cp") await mkdir(join(spec.args[2]!, "server"), { recursive: true }); return undefined; });
    let copied = false;
    const result = await withLocalStack(setup.options, async () => { copied = (await stat(join(setup.options.directory, "output/server"))).isDirectory(); });
    expect(result).toMatchObject({ kind: "completed", cleanup: "stopped" });
    expect(copied).toBe(true);
    const build = setup.calls.findIndex((spec) => spec.args.at(-1) === "build");
    const copy = setup.calls.findIndex((spec) => spec.command === "cp");
    expect(copy).toBeGreaterThan(build);
    expect(setup.calls[copy]!.args).toEqual(["-R", join(await realpath(setup.options.repository!), "services/tools/.output"), join(await realpath(setup.options.directory), "output")]);
    expect(setup.calls.find((spec) => spec.args[0]?.endsWith("index.mjs"))!.args[0]).toBe(join(setup.calls[copy]!.args[2]!, "server/index.mjs"));
    await expect(stat(join(setup.options.directory, "output"))).rejects.toThrow();
  });

  it.each(["health", "storage"])("retains the lock when the cancelled %s probe cannot prove release", async (phase) => {
    const setup = await fixture();
    let finishHost!: () => void;
    const hostEnd = new Promise<void>((resolve) => { finishHost = resolve; });
    let settled = false;
    setup.respond(async (spec) => {
      if (spec.args[0]?.endsWith("index.mjs")) {
        await hostEnd;
        return failed(spec);
      }
      if (spec.args.at(-1) === phase) {
        const cancelled = new Promise<void>((resolve) => spec.signal!.addEventListener("abort", () => resolve(), { once: true }));
        finishHost();
        await cancelled;
        await new Promise((resolve) => setTimeout(resolve, 10));
        settled = true;
        return { ...failed(spec), ownership: "uncertain" };
      }
      if (spec.args.includes("down")) expect(settled).toBe(true);
      return undefined;
    });
    const result = await withLocalStack(setup.options, async () => { throw new Error("must not run"); });
    expect(result).toMatchObject({ kind: "failed", cleanup: "retained" });
    expect(settled).toBe(true);
    await expectLocked(setup);
  });

  it("settles cancelled work before stopping fixtures when the host ends", async () => {
    const setup = await fixture();
    let finishHost!: () => void;
    const hostEnd = new Promise<void>((resolve) => { finishHost = resolve; });
    let settled = false;
    setup.respond(async (spec) => {
      if (spec.args[0]?.endsWith("index.mjs")) {
        await hostEnd;
        return failed(spec);
      }
      if (spec.args.includes("down")) expect(settled).toBe(true);
      return undefined;
    });
    const result = await withLocalStack(setup.options, async ({ signal }) => {
      const cancelled = new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      finishHost();
      await cancelled;
      await new Promise((resolve) => setTimeout(resolve, 10));
      settled = true;
    });
    expect(result).toMatchObject({ kind: "failed", cleanup: "stopped" });
    expect(settled).toBe(true);
  });

  it("uses the actual config parser and every remapped loopback port, then stops only its project without volume deletion", async () => {
    const setup = await fixture();
    const result = await withLocalStack(setup.options, async ({ manifest, environment }) => {
      expect(loadPlatformConfig(environment).feedbackEncryptionKey.byteLength).toBe(32);
      expect(manifest.bindings).toHaveLength(5);
      expect(new Set(manifest.bindings.map((binding) => binding.port)).size).toBe(5);
      expect(environment.PUBLIC_ORIGIN).toBe(manifest.origins.tools);
      expect(environment.ARTIFACT_S3_ENDPOINT).toBe(manifest.origins.storage);
      expect(environment.TOOLS_S3_ENDPOINT).toBe(manifest.origins.storage);
      expect(new URL(environment.DATABASE_URL!).hostname).toBe("127.0.0.1");
      expect(manifest.prerequisites.config.kind).toBe("passed");
      expect(manifest.prerequisites.storageHttp.kind).toBe("passed");
      for (const name of ["publisherBrowser", "privateOAuth", "markdownBrowser", "statusPublication"] as const) expect(manifest.prerequisites[name].kind).toBe("blocked");
      expect(JSON.stringify(manifest)).not.toContain(environment.FEEDBACK_ENCRYPTION_KEY);
      expect(JSON.stringify(manifest)).not.toContain(environment.UPLOAD_TOKEN);
      expect((await stat(setup.options.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(setup.options.directory, "identity.json"))).mode & 0o777).toBe(0o600);
    });
    expect(result).toMatchObject({ kind: "completed", cleanup: "stopped" });
    const docker = setup.calls.filter((spec) => spec.command === "docker");
    const launch = docker.find((spec) => spec.args.includes("up"))!;
    expect(launch.args.slice(-3)).toEqual(["postgres", "minio", "markdown-mock"]);
    expect(launch.args).not.toContain("platform");
    const down = docker.filter((spec) => spec.args.includes("down"));
    expect(down).toHaveLength(1);
    expect(down[0]!.args.slice(-3)).toEqual(["down", "--timeout", "10"]);
    expect(docker.every((spec) => spec.args[1] === "unix:///var/run/docker.sock")).toBe(true);
    expect(docker.every((spec) => !spec.args.includes("--volumes") && !spec.args.includes("-v"))).toBe(true);
    expect(setup.calls.every((spec) => Number.isFinite(spec.deadlineMs) && spec.deadlineMs > 0)).toBe(true);
    expect(setup.calls.every((spec) => spec.env?.FEEDBACK_ENCRYPTION_KEY !== "ignored-shell-key")).toBe(true);
    await expect(stat(join(setup.options.directory, "active.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(setup.options.directory, "manifest.json"), "utf8"))).toEqual(result.manifest);
  });

  it("retains the same origins, bindings, feedback key, project, and volume names across restart", async () => {
    const setup = await fixture();
    const keys: string[] = [];
    let encrypted: unknown;
    const first = await withLocalStack(setup.options, async ({ environment }) => {
      keys.push(environment.FEEDBACK_ENCRYPTION_KEY!);
      encrypted = createFeedbackEncryption(parseFeedbackEncryptionKey(environment.FEEDBACK_ENCRYPTION_KEY)).encrypt({ answer: "retained" }, "submission-1", "answers");
    });
    const second = await withLocalStack(setup.options, async ({ environment }) => {
      keys.push(environment.FEEDBACK_ENCRYPTION_KEY!);
      expect(createFeedbackEncryption(parseFeedbackEncryptionKey(environment.FEEDBACK_ENCRYPTION_KEY)).decrypt(encrypted, "submission-1", "answers")).toEqual({ answer: "retained" });
    });
    expect(second.kind).toBe("completed");
    expect(keys[0]).toBe(keys[1]);
    expect(second.manifest?.project).toBe(first.manifest?.project);
    expect(second.manifest?.volumes).toEqual(first.manifest?.volumes);
    expect(second.manifest?.origins).toEqual(first.manifest?.origins);
    expect(second.manifest?.bindings).toEqual(first.manifest?.bindings);
    const secondDirectory = { ...setup.options, directory: join(setup.directory, "another-private-run") };
    const other = await withLocalStack(secondDirectory, async () => {});
    expect(other.manifest?.project).not.toBe(first.manifest?.project);
  });

  it("refuses an occupied retained port before any command or recovery file overwrite", async () => {
    const setup = await fixture();
    const first = await withLocalStack(setup.options, async () => {});
    expect(first.kind).toBe("completed");
    const binding = first.manifest!.bindings.find((item) => item.service === "platform")!;
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(binding.port, "127.0.0.1", resolve); });
    try {
      const files = await retainedFiles(setup.options.directory);
      const count = setup.calls.length;
      const result = await withLocalStack(setup.options, async () => { throw new Error("must not run"); });
      expect(result).toMatchObject({ kind: "blocked", cleanup: "not-needed", reason: expect.stringContaining(`127.0.0.1:${binding.port}`) });
      expect(setup.calls).toHaveLength(count);
      expect(await retainedFiles(setup.options.directory)).toEqual(files);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    const restarted = await withLocalStack(setup.options, async () => {});
    expect(restarted.kind).toBe("completed");
    expect(restarted.manifest?.bindings).toEqual(first.manifest?.bindings);
  });

  it("recovers an older identity's bindings from its retained manifest without rotating its key or project", async () => {
    const setup = await fixture();
    const first = await withLocalStack(setup.options, async () => {});
    expect(first.kind).toBe("completed");
    const path = join(setup.options.directory, "identity.json");
    const identity = JSON.parse(await readFile(path, "utf8"));
    const { bindings: _bindings, ...original } = identity;
    await writeFile(path, JSON.stringify(original));
    const second = await withLocalStack(setup.options, async () => {});
    expect(second.kind).toBe("completed");
    expect(second.manifest?.origins).toEqual(first.manifest?.origins);
    expect(second.manifest?.bindings).toEqual(first.manifest?.bindings);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(identity);
  });

  it("refuses retained configuration without a recoverable port identity instead of selecting new ports", async () => {
    const setup = await fixture();
    await withLocalStack(setup.options, async () => {});
    const path = join(setup.options.directory, "identity.json");
    const { bindings: _bindings, ...identity } = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify(identity));
    await rm(join(setup.options.directory, "manifest.json"));
    const files = await retainedFiles(setup.options.directory);
    const count = setup.calls.length;
    const result = await withLocalStack(setup.options, async () => { throw new Error("must not run"); });
    expect(result).toMatchObject({ kind: "blocked", reason: expect.stringContaining("no port identity") });
    expect(setup.calls).toHaveLength(count);
    expect(await retainedFiles(setup.options.directory)).toEqual(files);
  });

  it("replays the missing-key rejection in the actual parser", () => {
    expect(() => loadPlatformConfig(platform)).toThrow(/FEEDBACK_ENCRYPTION_KEY/);
  });

  it("blocks an inherited database before any command and keeps its value out of the result", async () => {
    const setup = await fixture();
    const result = await withLocalStack({ ...setup.options, environment: { DATABASE_URL: "postgres://private-production" } }, async () => { throw new Error("must not run"); });
    expect(result.kind).toBe("blocked");
    expect(setup.calls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private-production");
  });

  it("rejects a run directory in the checkout before creating a key", async () => {
    const setup = await fixture();
    const result = await withLocalStack({ ...setup.options, directory: join(setup.options.repository!, "private") }, async () => {});
    expect(result.kind).toBe("blocked");
    expect(setup.calls).toEqual([]);
  });

  it("does not admit a second owner for an active run directory", async () => {
    const setup = await fixture();
    await withLocalStack(setup.options, async () => {
      const count = setup.calls.length;
      expect((await withLocalStack(setup.options, async () => {})).kind).toBe("blocked");
      expect(setup.calls).toHaveLength(count);
    });
  });

  it("reports missing Docker as blocked before any stack is started", async () => {
    const setup = await fixture();
    setup.respond(async (spec) => spec.args.includes("version") ? failed(spec) : undefined);
    const result = await withLocalStack(setup.options, async () => {});
    expect(result).toMatchObject({ kind: "blocked", cleanup: "not-needed" });
    expect(setup.calls).toHaveLength(1);
  });

  it.each(["postgres-migrate", "minio-seed", "build", "health"])("stops its Compose dependencies after a %s failure", async (step) => {
    const setup = await fixture();
    setup.respond(async (spec) => spec.args.at(-1) === step ? failed(spec) : undefined);
    const result = await withLocalStack(setup.options, async () => { throw new Error("must not run"); });
    expect(result).toMatchObject({ kind: "failed", cleanup: "stopped" });
    expect(setup.calls.filter((spec) => spec.args.includes("down"))).toHaveLength(1);
  });

  it("reports browser storage prerequisites blocked when signed PUT or ETag checks fail", async () => {
    const setup = await fixture();
    setup.respond(async (spec) => spec.args.at(-1) === "storage" ? { kind: "succeeded", stdout: "storage-blocked\n", log: spec.log } : undefined);
    const result = await withLocalStack(setup.options, async ({ manifest }) => {
      expect(manifest.prerequisites.storageHttp.kind).toBe("blocked");
      expect(manifest.prerequisites.publisherBrowser.kind).toBe("blocked");
    });
    expect(result.kind).toBe("completed");
  });

  it("keeps cleanup independent of work cancellation and reports a failed down", async () => {
    const setup = await fixture();
    const controller = new AbortController();
    setup.respond(async (spec) => {
      if (!spec.args.includes("down")) return;
      expect(spec.signal).toBeUndefined();
      return failed(spec);
    });
    const result = await withLocalStack({ ...setup.options, signal: controller.signal }, async () => { controller.abort(); });
    expect(result).toMatchObject({ kind: "failed", cleanup: "retained" });
    expect(await readFile(join(setup.options.directory, "identity.json"), "utf8")).toContain("feedbackKey");
    await expectLocked(setup);
  });

  it("redacts generated credentials from command logs and never passes them in arguments", async () => {
    const setup = await fixture();
    await withLocalStack(setup.options, async ({ environment }) => {
      const key = environment.FEEDBACK_ENCRYPTION_KEY!;
      for (const spec of setup.calls) {
        expect(spec.args.join(" ")).not.toContain(key);
        expect(spec.redact?.(`${key} ${environment.UPLOAD_TOKEN} ?X-Amz-Signature=private-signature`)).not.toContain("private-signature");
      }
    });
  });

  it("retains an invalid identity instead of creating a new key for existing volumes", async () => {
    const setup = await fixture();
    await mkdir(setup.options.directory);
    await writeFile(join(setup.options.directory, "identity.json"), JSON.stringify({ version: 1, project: "bad", feedbackKey: "bad-key" }));
    expect((await withLocalStack(setup.options, async () => {})).kind).toBe("blocked");
    expect(await readFile(join(setup.options.directory, "identity.json"), "utf8")).toContain("bad-key");
    expect(setup.calls).toEqual([]);
  });

  it("does not claim full cleanup when host process ownership is uncertain", async () => {
    const setup = await fixture();
    setup.respond(async (spec) => {
      if (!spec.args[0]?.endsWith("index.mjs")) return;
      await new Promise<void>((resolve) => spec.signal?.addEventListener("abort", () => resolve(), { once: true }));
      return { kind: "failed", termination: { kind: "owner", reason: "scope-closed" }, exit: { kind: "unavailable", reason: "test" },
        ownership: "uncertain", escalation: "kill", log: { kind: "written", path: spec.log }, reasons: [] };
    });
    const result = await withLocalStack(setup.options, async () => {});
    expect(result).toMatchObject({ kind: "failed", cleanup: "retained" });
    expect(setup.calls.filter((spec) => spec.args.includes("down"))).toHaveLength(1);
    await expectLocked(setup);
  });

  it.each(["outcome", "throw"])("retains the lock after uncertain command ownership before Compose starts through %s", async (failure) => {
    const setup = await fixture();
    setup.respond(async (spec) => {
      if (!spec.args.includes("version")) return;
      if (failure === "throw") throw new Error("executor failed without a release result");
      return { kind: "failed", termination: { kind: "owner", reason: "scope-closed" }, exit: { kind: "unavailable", reason: "test" },
        ownership: "uncertain", escalation: "kill", log: { kind: "written", path: spec.log }, reasons: [] };
    });
    const result = await withLocalStack(setup.options, async () => { throw new Error("must not run"); });
    expect(result).toMatchObject({ kind: "failed", cleanup: "retained" });
    expect(setup.calls.some((spec) => spec.args.includes("up") || spec.args.includes("down"))).toBe(false);
    await expectLocked(setup);
  });

  it("rejects a container-only signing endpoint through the executable config check", async () => {
    const setup = await fixture();
    let environment: CommandSpec["env"];
    await withLocalStack(setup.options, async (stack) => { environment = stack.environment; });
    const log = join(setup.directory, "container-endpoint.log");
    const result = await withOwnedCommands({ graceMs: 1_000 }, (commands) => commands.execute({
      command: process.execPath,
      args: ["--import", "tsx", fileURLToPath(new URL("./local-stack-check.ts", import.meta.url)), "config"],
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { PATH: process.env.PATH, ...environment, ARTIFACT_S3_ENDPOINT: "http://minio:9000" },
      deadlineMs: 30_000, log,
    }));
    expect(result).toMatchObject({ kind: "failed", exit: { kind: "exited", code: 1 } });
    expect(await readFile(log, "utf8")).toContain("ARTIFACT_S3_ENDPOINT must be an owned loopback origin");
  }, 40_000);
});
