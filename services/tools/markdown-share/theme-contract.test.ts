import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("integrated Markdown Share theme", () => {
  it("uses the suite rose ramp for interactive accents", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toContain("--markdown-share-accent: #e11d48");
    expect(styles).toContain("--markdown-share-accent-soft: #fda4af");
    expect(styles).toContain("background: var(--markdown-share-accent);");
  });

  it("namespaces every custom property away from the shared Tools theme", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
    const customProperties = [...styles.matchAll(/--[a-z][a-z-]*/g)].map(([property]) => property);

    expect(customProperties.length).toBeGreaterThan(0);
    expect(customProperties.every((property) => property.startsWith("--markdown-share-"))).toBe(true);
  });

  it("sets dark text on every route shell", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.landing-shell,\s*\.status-shell\s*\{[^}]*color: var\(--markdown-share-ink\);/s);
    expect(styles).toMatch(/\.editor-shell\s*\{[^}]*color: var\(--markdown-share-ink\);/s);
  });

  it("prints the preview without hiding application mount ancestors", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
    const printStyles = styles.slice(styles.indexOf("@media print"));

    expect(printStyles).not.toContain("#root");
    expect(printStyles).toContain(".editor-shell > :not(.workspace)");
    expect(printStyles).toContain(".editor-shell .workspace > :not(.preview-panel)");
    expect(printStyles).toContain(".editor-shell .preview-panel > :not(#print-preview)");
  });
});
