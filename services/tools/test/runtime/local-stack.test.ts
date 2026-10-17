import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadPlatformConfig } from "../../src/config.ts";
import { createFeedbackEncryption, parseFeedbackEncryptionKey } from "../../feedback/encryption.ts";
import type { CommandExecutor, CommandOutcome, CommandSpec } from "./commands.ts";
import { withOwnedCommands } from "./commands.ts";
import { withLocalStack, type LocalStackOptions } from "./local-stack.ts";

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
    services: Record<string, { ports?: { target: number; published: string; host_ip?: string; protocol?: string }[]; environment?: Record<string, string> }>;
    volumes: Record<string, { name?: string }>;
  } = {
    services: {
      postgres: { ports: [{ target: 5432, published: "5432" }] },
      minio: { ports: [{ target: 9000, published: "9000" }, { target: 9001, published: "9001" }] },
      "markdown-mock": { ports: [{ target: 8787, published: "8787" }] },
      "postgres-migrate": {}, "minio-seed": {},
      platform: { environment: platform, ports: [{ target: 3000, published: "3000" }] },
    },
    volumes: { "postgres-data": {}, "minio-data": {} },
  };
  const execute: CommandExecutor = { async execute(spec) {
    calls.push(spec);
    await writeFile(spec.log, "fixture command log\n");
    const supplied = await response(spec);
    if (supplied) return supplied;
    let stdout = "";
    if (spec.args.includes("config") && spec.command === "docker") {
      const config = structuredClone(base);
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
        config.volumes = Object.fromEntries(Object.keys(base.volumes).map((name) => [name, { name: `${project}_${name}` }]));
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
  it("allows the owned Tools and sandbox download origins without a wildcard", async () => {
    const setup = await fixture();
    const result = await withLocalStack(setup.options, async ({ manifest }) => {
      const override = await readFile(join(setup.options.directory, "compose.override.yaml"), "utf8");
      expect(override).toContain(`MINIO_API_CORS_ALLOW_ORIGIN: ${JSON.stringify(`${manifest.origins.tools},null`)}`);
      expect(override).not.toContain('MINIO_API_CORS_ALLOW_ORIGIN: "*"');
    });
    expect(result).toMatchObject({ kind: "completed", cleanup: "stopped" });
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
