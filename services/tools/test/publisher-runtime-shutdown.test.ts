import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Publisher runtime shutdown", () => {
  it("drains tracked Publisher work before closing service resources", async () => {
    const source = await readFile(new URL("../src/runtime.ts", import.meta.url), "utf8");
    const stop = source.slice(source.indexOf("const stop = async () =>"), source.indexOf("event: \"platform.runtime_ready\""));

    expect(stop.indexOf("activityTracker.waitForIdle()"))
      .toBeLessThan(stop.indexOf("Object.values(services).map((service) => service.close())"));
    expect(stop.match(/await Promise\.all\(/g)).toHaveLength(2);
  });
});
