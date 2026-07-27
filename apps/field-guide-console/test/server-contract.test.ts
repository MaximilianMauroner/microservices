import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("hard-terminates production after the shutdown deadline", async () => {
  const source = await readFile(
    new URL("../src/server.ts", import.meta.url),
    "utf8",
  );

  expect(source).toContain("terminate: () => process.exit(1)");
});
