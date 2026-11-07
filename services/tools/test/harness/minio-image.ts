import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CommandExecutor, CommandOutcome } from "./commands.ts";
import { VerificationBlocked } from "./receipt.ts";

export type MinioImage = Readonly<{
  reference: `tools-verify-minio:${string}`;
  inputDigest: string;
  platform: string;
  imageId: `sha256:${string}`;
  source: "store" | "archive" | "built";
}>;

const inputLabel = "tools.verify.minio-input";

function requireContextFreeDockerfile(bytes: Buffer): void {
  const blocked = (reason: string): never => {
    throw new VerificationBlocked(`BLOCKED minio-dockerfile. ${reason}`);
  };
  let continued = "";
  for (const line of bytes.toString("utf8").split(/\r?\n/)) {
    if (/^\s*#\s*(syntax|escape|check)\s*=/i.test(line)) blocked("Parser directives are unsupported.");
    if (/^\s*(#|$)/.test(line)) continue;
    const instruction = continued + line;
    if (instruction.endsWith("\\")) {
      continued = instruction.slice(0, -1);
      continue;
    }
    continued = "";
    if (instruction.includes("<<")) blocked("Heredocs are unsupported.");
    const match = /^\s*([a-z]+)(?:\s+(.*))?$/i.exec(instruction);
    if (!match) blocked("The Dockerfile instruction is unsupported.");
    const name = match![1]!.toUpperCase();
    let argumentsText = match![2] ?? "";
    if (name === "ADD" || name === "ONBUILD") blocked(`${name} is unsupported.`);
    if (name === "COPY" || name === "RUN") {
      let from = false;
      while (argumentsText.startsWith("--")) {
        const flag = /^--([a-z]+)=([^\s]+)(?:\s+|$)/.exec(argumentsText);
        if (!flag || /["'\\$]/.test(flag[2]!)) blocked(`The ${name} flag is unsupported.`);
        const [, key, value] = flag!;
        argumentsText = argumentsText.slice(flag![0].length);
        if (name === "COPY") {
          if (key === "from") from = true;
          else if (!["chown", "chmod", "exclude"].includes(key!)) blocked("The COPY flag is unsupported.");
        } else {
          if (key !== "mount") blocked("The RUN flag is unsupported.");
          const mount = new Map(value!.split(",").map((part) => {
            const equals = part.indexOf("=");
            return equals < 0 ? [part, ""] : [part.slice(0, equals), part.slice(equals + 1)];
          }));
          const type = mount.get("type") ?? "bind";
          if (type === "bind" && !mount.get("from")) blocked("RUN bind mounts need an explicit from source.");
          if (!["bind", "cache", "tmpfs"].includes(type)) blocked("The RUN mount type is unsupported.");
        }
      }
      if (name === "COPY" && !from) blocked("COPY needs an explicit --from source.");
    } else if (!["FROM", "ENV", "ARG", "LABEL", "ENTRYPOINT", "CMD", "USER", "WORKDIR", "EXPOSE", "VOLUME", "STOPSIGNAL", "SHELL", "HEALTHCHECK"].includes(name)) {
      blocked(`The ${name} instruction is unsupported.`);
    }
  }
  if (continued) blocked("An unfinished continuation is unsupported.");
}

function cacheMiss(outcome: CommandOutcome): boolean {
  return outcome.kind === "failed" && outcome.termination.kind === "natural"
    && outcome.exit.kind === "exited" && outcome.exit.code !== 0
    && outcome.ownership === "released" && outcome.escalation === "none"
    && outcome.log.kind === "written" && outcome.reasons.length === 0;
}

function stdout(outcome: CommandOutcome, step: string): string {
  if (outcome.kind === "succeeded") return outcome.stdout;
  const ErrorType = outcome.kind === "blocked" ? VerificationBlocked : Error;
  throw new ErrorType(`MinIO ${step} did not succeed. See its private command log.`, { cause: outcome });
}

async function outsideCheckout(root: string, directory: string): Promise<string> {
  const missing: string[] = [];
  let ancestor = resolve(directory);
  for (;;) {
    try {
      ancestor = await realpath(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  const path = join(ancestor, ...missing);
  const location = relative(await realpath(root), path);
  if (!location || !(location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location))) {
    throw new VerificationBlocked("BLOCKED minio-cache. The cache directory must be outside the checkout.");
  }
  return path;
}

export async function resolveMinioImage(options: Readonly<{
  commands: CommandExecutor;
  root: string;
  cacheDirectory?: string;
  signal: AbortSignal;
  log: (step: string) => string;
}>): Promise<MinioImage> {
  const { commands, root, signal, log } = options;
  signal.throwIfAborted();
  const dockerfile = await readFile(join(root, "Dockerfile.minio.local"));
  requireContextFreeDockerfile(dockerfile);
  const environment = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  const docker = (args: readonly string[], step: string, deadlineMs = 30_000) => commands.execute({
    command: "docker", args: ["--host", "unix:///var/run/docker.sock", ...args], cwd: root,
    env: environment, deadlineMs, signal, log: log(`minio-${step}`),
  });
  const platform = stdout(await docker(["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"], "platform"), "platform").trim();
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(platform)) {
    throw new VerificationBlocked("BLOCKED minio-platform. Docker did not report its server OS and architecture.");
  }
  const inputDigest = createHash("sha256").update(JSON.stringify(["tools-verify-minio-v1", platform])).update("\0").update(dockerfile).digest("hex");
  const reference = `tools-verify-minio:${inputDigest}` as const;
  async function inspect(target: string, step: string): Promise<MinioImage["imageId"] | undefined> {
    const outcome = await docker(["image", "inspect", "--format", "{{json .}}", target], step);
    if (cacheMiss(outcome)) return undefined;
    const output = stdout(outcome, step);
    let image: { Id?: unknown; Os?: unknown; Architecture?: unknown; Config?: { Labels?: Record<string, unknown> } } | null;
    try { image = JSON.parse(output); } catch { return undefined; }
    if (!image || typeof image.Id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(image.Id)
      || typeof image.Os !== "string" || typeof image.Architecture !== "string"
      || `${image.Os}/${image.Architecture}` !== platform || image.Config?.Labels?.[inputLabel] !== inputDigest) return undefined;
    return image.Id as MinioImage["imageId"];
  }
  const image = (imageId: MinioImage["imageId"], source: MinioImage["source"]): MinioImage => ({ reference, inputDigest, platform, imageId, source });
  const stored = await inspect(reference, "store-inspect");
  if (stored) return image(stored, "store");

  const cache = await outsideCheckout(root, options.cacheDirectory ?? join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "tools-verify"));
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const archive = join(cache, `minio-${inputDigest}.tar`);
  let archived = false;
  try { archived = (await lstat(archive)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (archived) {
    const loaded = await docker(["image", "load", "--input", archive], "archive-load", 120_000);
    if (!cacheMiss(loaded)) {
      stdout(loaded, "archive-load");
      const restored = await inspect(reference, "archive-inspect");
      if (restored) return image(restored, "archive");
    }
  }

  const temporary = await mkdtemp(join(cache, ".minio-"));
  try {
    const context = join(temporary, "context");
    const snapshot = join(temporary, "Dockerfile");
    const iid = join(temporary, "image-id");
    await mkdir(context);
    await writeFile(snapshot, dockerfile, { mode: 0o600 });
    stdout(await docker(["build", "--platform", platform, "--file", snapshot, "--label", `${inputLabel}=${inputDigest}`,
      "--tag", reference, "--iidfile", iid, context], "build", 900_000), "build");
    const builtId = (await readFile(iid, "utf8")).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(builtId)) throw new Error("MinIO build did not record a valid image ID.");
    const built = await inspect(builtId, "build-inspect");
    if (!built || built !== builtId) throw new Error("MinIO build did not produce an image with the expected input label and platform.");
    const pending = join(temporary, "archive.tar");
    stdout(await docker(["image", "save", "--output", pending, reference], "archive-save", 120_000), "archive-save");
    signal.throwIfAborted();
    await rename(pending, archive);
    return image(built, "built");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
