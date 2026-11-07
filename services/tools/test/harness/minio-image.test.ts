import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandExecutor, CommandOutcome, CommandSpec } from "./commands.ts";
import { resolveMinioImage } from "./minio-image.ts";
import { VerificationBlocked } from "./receipt.ts";

type Image = {
  Id: string;
  Os: string;
  Architecture: string;
  Config: { Labels: Record<string, string> };
};
type Archive = { reference: string; image: Image };
const inputLabel = "tools.verify.minio-input";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

function failed(spec: CommandSpec): Extract<CommandOutcome, { kind: "failed" | "blocked" }> {
  return { kind: "failed", termination: { kind: "natural" }, exit: { kind: "exited", code: 1 },
    escalation: "none", ownership: "released", log: { kind: "written", path: spec.log }, reasons: [] };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "minio-image-test-"));
  directories.push(directory);
  const root = join(directory, "checkout");
  const cacheDirectory = join(directory, "cache");
  await mkdir(root);
  const dockerfile = await readFile(new URL("../../../../Dockerfile.minio.local", import.meta.url));
  await writeFile(join(root, "Dockerfile.minio.local"), dockerfile);
  const calls: CommandSpec[] = [];
  const images = new Map<string, Image>();
  const contexts: { path: string; files: string[]; dockerfile: Buffer }[] = [];
  const state = { platform: "linux/amd64", builds: 0, loads: 0, saves: 0, store: "absent" as "absent" | "matching" | "wrong-label" | "wrong-platform" };
  let respond: (spec: CommandSpec) => Promise<CommandOutcome | undefined> = async () => undefined;
  const commands: CommandExecutor = { async execute(spec) {
    calls.push(spec);
    const response = await respond(spec);
    if (response) return response;
    expect(spec.command).toBe("docker");
    expect(spec.args.slice(0, 2)).toEqual(["--host", "unix:///var/run/docker.sock"]);
    const args = spec.args.slice(2);
    const flag = (name: string) => args[args.indexOf(name) + 1]!;
    let output = "";
    if (args[0] === "version") output = state.platform;
    else if (args[0] === "image" && args[1] === "inspect") {
      const target = args.at(-1)!;
      if (!images.has(target) && state.store !== "absent" && target.startsWith("tools-verify-minio:")) {
        const image: Image = { Id: `sha256:${"a".repeat(64)}`, Os: "linux", Architecture: "amd64",
          Config: { Labels: { [inputLabel]: state.store === "wrong-label" ? "wrong" : target.split(":")[1]! } } };
        if (state.store === "wrong-platform") image.Architecture = "arm64";
        images.set(target, image);
        images.set(image.Id, image);
        state.store = "absent";
      }
      const found = images.get(target);
      if (!found) return failed(spec);
      output = JSON.stringify(found);
    } else if (args[0] === "build") {
      const build = ++state.builds;
      contexts.push({ path: args.at(-1)!, files: await readdir(args.at(-1)!), dockerfile: await readFile(flag("--file")) });
      const [label, digest] = flag("--label").split("=");
      const [Os, Architecture] = flag("--platform").split("/");
      const image: Image = { Id: `sha256:${String(build).padStart(64, "0")}`, Os: Os!, Architecture: Architecture!,
        Config: { Labels: { [label!]: digest! } } };
      images.set(flag("--tag"), image);
      images.set(image.Id, image);
      await writeFile(flag("--iidfile"), image.Id);
    } else if (args[0] === "image" && args[1] === "save") {
      state.saves++;
      const target = args.at(-1)!;
      const image = images.get(target)!;
      const archive: Archive = { reference: target.startsWith("sha256:") ? "" : target, image };
      await writeFile(flag("--output"), JSON.stringify(archive));
    } else if (args[0] === "image" && args[1] === "load") {
      state.loads++;
      let archive: Archive;
      try { archive = JSON.parse(await readFile(flag("--input"), "utf8")); }
      catch { return failed(spec); }
      if (archive.reference) images.set(archive.reference, archive.image);
      images.set(archive.image.Id, archive.image);
    } else throw new Error(`Unexpected Docker command ${JSON.stringify(args)}.`);
    return { kind: "succeeded", stdout: output, log: spec.log };
  } };
  const controller = new AbortController();
  const options = { commands, root, cacheDirectory, signal: controller.signal, log: (step: string) => join(directory, `${step}.log`) };
  return { options, calls, state, images, contexts, controller, dockerfile,
    resolve: () => resolveMinioImage(options),
    respond(handler: typeof respond) { respond = handler; },
    archive: (digest: string) => join(cacheDirectory, `minio-${digest}.tar`),
  };
}

describe("resolveMinioImage", () => {
  it("selects an image with the full input label from the store without loading or building", async () => {
    const setup = await fixture();
    setup.state.store = "matching";
    const image = await setup.resolve();
    expect(image).toMatchObject({ source: "store", platform: "linux/amd64", imageId: `sha256:${"a".repeat(64)}` });
    expect(image.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(image.reference).toBe(`tools-verify-minio:${image.inputDigest}`);
    expect(setup.state).toMatchObject({ builds: 0, loads: 0, saves: 0 });
  });

  it.each(["wrong-label", "wrong-platform"] as const)("does not use a stored image with %s", async (store) => {
    const setup = await fixture();
    setup.state.store = store;
    const image = await setup.resolve();
    expect(image.source).toBe("built");
    expect(image.imageId).not.toBe(`sha256:${"a".repeat(64)}`);
    expect(setup.state.builds).toBe(1);
  });

  it("loads and verifies the saved archive without another build when the store is empty", async () => {
    const setup = await fixture();
    const cold = await setup.resolve();
    setup.images.clear();
    const restored = await setup.resolve();
    expect(restored).toEqual({ ...cold, source: "archive" });
    expect(setup.state).toMatchObject({ builds: 1, loads: 1, saves: 1 });
    expect((await setup.resolve()).source).toBe("store");
    expect(setup.state.builds).toBe(1);
  });

  it("builds from the checked Dockerfile snapshot and an empty context, then publishes its archive", async () => {
    const setup = await fixture();
    const image = await setup.resolve();
    expect(image.source).toBe("built");
    expect(setup.state).toMatchObject({ builds: 1, loads: 0, saves: 1 });
    expect(setup.contexts).toHaveLength(1);
    expect(setup.contexts[0]!.files).toEqual([]);
    expect(setup.contexts[0]!.dockerfile).toEqual(setup.dockerfile);
    expect(setup.contexts[0]!.path.startsWith(setup.options.root)).toBe(false);
    const archive: Archive = JSON.parse(await readFile(setup.archive(image.inputDigest), "utf8"));
    expect(archive.reference).toBe(image.reference);
    expect(archive.image.Id).toBe(image.imageId);
    expect(archive.image.Config.Labels[inputLabel]).toBe(image.inputDigest);
    expect(await readdir(setup.options.cacheDirectory)).toEqual([`minio-${image.inputDigest}.tar`]);
    for (const spec of setup.calls) {
      expect(Object.keys(spec.env!).sort()).toEqual(["HOME", "PATH", "TMPDIR"]);
      expect(spec.signal).toBe(setup.options.signal);
    }
    expect((await setup.resolve()).imageId).toBe(image.imageId);
    expect(setup.state.builds).toBe(1);
  });

  it.each(["architecture", "OS", "Dockerfile bytes"])("builds a different image when %s changes", async (input) => {
    const setup = await fixture();
    const before = await setup.resolve();
    if (input === "architecture") setup.state.platform = "linux/arm64";
    else if (input === "OS") setup.state.platform = "windows/amd64";
    else await writeFile(join(setup.options.root, "Dockerfile.minio.local"), Buffer.concat([setup.dockerfile, Buffer.from("\n# changed bytes\n")]));
    const after = await setup.resolve();
    expect(after.source).toBe("built");
    expect(after.inputDigest).not.toBe(before.inputDigest);
    expect(after.reference).not.toBe(before.reference);
    expect(after.platform).toBe(setup.state.platform);
    expect(setup.state.builds).toBe(2);
    expect((await setup.resolve()).source).toBe("store");
    expect(setup.state.builds).toBe(2);
    expect(await readdir(setup.options.cacheDirectory)).toHaveLength(2);
  });

  it.each([
    "ADD https://example.com/file /file", "COPY local /file", "COPY --chown=1000 local /file",
    "COPY local /file --from=build", "ONBUILD COPY file /file", "ONBUILD RUN true",
    "# syntax=docker/dockerfile:1", "  # SYNTAX = docker/dockerfile:1", "# escape=`",
    "RUN --mount=type=bind,target=/src true", "RUN --mount=target=/src true",
    "RUN --mount=type=bind,from=,target=/src true", "RUN --mount=\"type=bind,target=/src\" true",
    "RUN --mount=type=bind,\\\n    target=/src true", "RUN <<EOF\ntrue\nEOF",
    "COPY --from=$SOURCE /file /file", "UNKNOWN file",
  ])("blocks unsupported Dockerfile input before using a cached image, %s", async (instruction) => {
    const setup = await fixture();
    setup.state.store = "matching";
    await writeFile(join(setup.options.root, "Dockerfile.minio.local"), `${setup.dockerfile.toString()}\n${instruction}\n`);
    await expect(setup.resolve()).rejects.toBeInstanceOf(VerificationBlocked);
    expect(setup.calls).toEqual([]);
    expect(setup.state.builds).toBe(0);
  });

  it("accepts a bind mount with an explicit image source", async () => {
    const setup = await fixture();
    await writeFile(join(setup.options.root, "Dockerfile.minio.local"), `${setup.dockerfile.toString()}\nRUN --mount=from=build,target=/src true\n`);
    expect((await setup.resolve()).source).toBe("built");
    expect(setup.state.builds).toBe(1);
  });

  it.each(["label", "platform", "missing tag", "corrupt"])("rebuilds an archive with a %s mismatch and replaces it with a reusable archive", async (mismatch) => {
    const setup = await fixture();
    const cold = await setup.resolve();
    const path = setup.archive(cold.inputDigest);
    const archive: Archive = JSON.parse(await readFile(path, "utf8"));
    if (mismatch === "label") archive.image.Config.Labels[inputLabel] = "wrong";
    if (mismatch === "platform") archive.image.Architecture = "arm64";
    if (mismatch === "missing tag") archive.reference = "";
    await writeFile(path, mismatch === "corrupt" ? "not an archive" : JSON.stringify(archive));
    setup.images.clear();
    const replacement = await setup.resolve();
    expect(replacement).toEqual({ ...cold, imageId: `sha256:${"2".padStart(64, "0")}` });
    expect(setup.state).toMatchObject({ builds: 2, loads: 1, saves: 2 });
    setup.images.clear();
    expect(await setup.resolve()).toEqual({ ...replacement, source: "archive" });
    expect(setup.state.builds).toBe(2);
  });

  it.each(["store-inspect", "archive-load", "archive-save"])("preserves uncertain command ownership during %s", async (step) => {
    const setup = await fixture();
    if (step === "archive-load") {
      await setup.resolve();
      setup.images.clear();
    }
    let failure: CommandOutcome | undefined;
    setup.respond(async (spec) => {
      if (!spec.log.endsWith(`minio-${step}.log`)) return undefined;
      failure = { ...failed(spec), ownership: "uncertain" };
      return failure;
    });
    await expect(setup.resolve()).rejects.toMatchObject({ cause: { ownership: "uncertain" } });
    expect(failure).toBeDefined();
    expect(setup.state.builds).toBe(step === "store-inspect" ? 0 : 1);
    if (step !== "store-inspect") expect((await readdir(setup.options.cacheDirectory)).filter((file) => file.startsWith(".minio-"))).toEqual([]);
  });

  it.each(["deadline", "not-started", "blocked", "log-failure"])("does not hide a %s command failure as a cache miss", async (kind) => {
    const setup = await fixture();
    setup.respond(async (spec) => {
      if (!spec.log.endsWith("store-inspect.log")) return undefined;
      if (kind === "not-started") return { kind: "not-started", reason: "cancelled" };
      const failure = failed(spec);
      if (kind === "deadline") return { ...failure, termination: { kind: "deadline", limitMs: 30_000 } };
      if (kind === "blocked") return { ...failure, kind: "blocked" };
      return { ...failure, log: { kind: "failed", path: spec.log, reason: "disk full" } };
    });
    await expect(setup.resolve()).rejects.toHaveProperty("cause");
    expect(setup.state).toMatchObject({ builds: 0, loads: 0, saves: 0 });
  });

  it("propagates executor exceptions unchanged", async () => {
    const setup = await fixture();
    const failure = new Error("executor ownership is unknown");
    setup.respond(async () => { throw failure; });
    await expect(setup.resolve()).rejects.toBe(failure);
    expect(setup.state.builds).toBe(0);
  });

  it("cleans temporary build and save files after an ordinary command failure", async () => {
    const setup = await fixture();
    setup.respond(async (spec) => {
      if (!spec.args.includes("save")) return undefined;
      await writeFile(spec.args[spec.args.indexOf("--output") + 1]!, "partial archive");
      return failed(spec);
    });
    await expect(setup.resolve()).rejects.toHaveProperty("cause");
    expect(await readdir(setup.options.cacheDirectory)).toEqual([]);
    expect(setup.state.builds).toBe(1);
    expect(setup.images.size).toBeGreaterThan(0);
  });

  it("does not save or return a built image whose label cannot be verified", async () => {
    const setup = await fixture();
    setup.respond(async (spec) => {
      if (!spec.log.endsWith("build-inspect.log")) return undefined;
      const image = setup.images.get(spec.args.at(-1)!)!;
      image.Config.Labels[inputLabel] = "wrong";
      return undefined;
    });
    await expect(setup.resolve()).rejects.toThrow("expected input label and platform");
    expect(setup.state).toMatchObject({ builds: 1, saves: 0 });
    expect(await readdir(setup.options.cacheDirectory)).toEqual([]);
  });

  it("builds the bytes that were checked when the checkout Dockerfile changes during resolution", async () => {
    const setup = await fixture();
    setup.respond(async (spec) => {
      if (spec.args.includes("build")) await writeFile(join(setup.options.root, "Dockerfile.minio.local"), "COPY unsafe /file\n");
      return undefined;
    });
    const image = await setup.resolve();
    expect(image.source).toBe("built");
    expect(setup.contexts[0]!.dockerfile).toEqual(setup.dockerfile);
    await expect(setup.resolve()).rejects.toBeInstanceOf(VerificationBlocked);
    expect(setup.state.builds).toBe(1);
  });

  it("keeps each resolved image and publishes a complete archive during concurrent cache misses", async () => {
    const setup = await fixture();
    const images = await Promise.all([setup.resolve(), setup.resolve()]);
    expect(images.every((image) => image.source === "built")).toBe(true);
    expect(new Set(images.map((image) => image.inputDigest)).size).toBe(1);
    expect(new Set(images.map((image) => image.imageId)).size).toBe(2);
    for (const image of images) expect(setup.images.get(image.imageId)?.Config.Labels[inputLabel]).toBe(image.inputDigest);
    expect(await readdir(setup.options.cacheDirectory)).toEqual([`minio-${images[0]!.inputDigest}.tar`]);
    setup.images.clear();
    const restored = await setup.resolve();
    expect(restored.source).toBe("archive");
    expect(images.map((image) => image.imageId)).toContain(restored.imageId);
    expect(setup.state.builds).toBe(2);
  });

  it("refuses to place cache state in the checkout", async () => {
    const setup = await fixture();
    await expect(resolveMinioImage({ ...setup.options, cacheDirectory: join(setup.options.root, "cache") })).rejects.toBeInstanceOf(VerificationBlocked);
    expect(await readdir(setup.options.root)).toEqual(["Dockerfile.minio.local"]);
    expect(setup.state.builds).toBe(0);
  });
});
