import { access, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository = new URL("../../../", import.meta.url);
const run = promisify(execFile);

describe("repository runtime boundaries", () => {
  it("keeps every tracked deployable under services", async () => {
    const services = await directories(new URL("services/", repository));
    expect(services).toEqual(expect.arrayContaining(["markdown-share", "network-console", "tools"]));
    expect(await trackedFiles("apps", "jobs", "packages")).toEqual([]);
  });

  it("keeps tools products directly inside the tools service", async () => {
    for (const name of ["dashboard", "field-guide", "publisher", "status"]) {
      await expect(access(new URL(`services/tools/${name}/package.json`, repository))).resolves.toBeUndefined();
      await expect(access(new URL(`services/tools/${name}/railway.json`, repository))).rejects.toThrow();
    }
  });

  it("keeps tools-only runtime libraries inside the tools service", async () => {
    const runtime = await directories(new URL("services/tools/runtime/", repository));
    expect(runtime).toEqual(["domain", "security", "suite-chrome"]);
  });
});

async function directories(url: URL) {
  const entries = await readdir(url, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function trackedFiles(...paths: string[]) {
  const { stdout } = await run("git", ["ls-files", "--", ...paths], { cwd: fileURLToPath(repository) });
  return stdout.trim() ? stdout.trim().split("\n") : [];
}
