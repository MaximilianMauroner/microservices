import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const assets = new URL("../public/assets/", import.meta.url);

describe("static UI assets", () => {
  test("operations script uses conditional writes and explicit conflicts", async () => {
    const script = await readFile(new URL("ops.js", assets), "utf8");

    expect(script).toContain('"If-Match": `"${currentRevision()}"`');
    expect(script).toContain("response.status === 409");
    expect(script).toContain("showConflict(payload)");
    expect(script).toContain("data-delete-confirmation");
    expect(script).toContain("window.location.reload()");
    expect(script).not.toContain("setInterval");
    expect(script).not.toContain("setTimeout");
  });

  test("assets contain no inline-handler dependency and respect reduced motion", async () => {
    const css = await readFile(new URL("tools.css", assets), "utf8");
    const script = await readFile(new URL("ops.js", assets), "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(":focus-visible");
    expect(script).toContain("addEventListener");
    expect(script).not.toContain("innerHTML");
    expect(script).not.toContain("eval(");
  });
});
