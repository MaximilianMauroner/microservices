import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("integrated Markdown Share theme", () => {
  it("uses the suite rose ramp for interactive accents", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toContain("--accent: #e11d48");
    expect(styles).toContain("--accent-soft: #fda4af");
    expect(styles).toContain("background: var(--accent);");
  });
});
