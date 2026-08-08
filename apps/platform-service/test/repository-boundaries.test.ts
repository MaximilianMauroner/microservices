import { access, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const repository = new URL("../../../", import.meta.url);

describe("repository runtime boundaries", () => {
  it("keeps independently running applications under apps", async () => {
    const applications = await directories(new URL("apps/", repository));
    expect(applications).toEqual(["markdown-share", "network-console", "platform-service"]);
  });

  it("keeps embedded platform capabilities under packages without deploy configs", async () => {
    for (const name of ["artifact-publisher", "field-guide-console", "tools-web"]) {
      await expect(access(new URL(`packages/${name}/package.json`, repository))).resolves.toBeUndefined();
      await expect(access(new URL(`packages/${name}/railway.json`, repository))).rejects.toThrow();
    }
  });

  it("groups platform-owned pages by feature", async () => {
    const features = await directories(new URL("apps/platform-service/src/features/", repository));
    expect(features).toEqual(["catalog", "documents", "manage", "money", "publish", "review", "status"]);
  });
});

async function directories(url: URL) {
  const entries = await readdir(url, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
