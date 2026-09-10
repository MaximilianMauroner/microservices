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

  it("keeps runtime custom-property writes aligned with the stylesheet", async () => {
    const [styles, workspace, viewport] = await Promise.all([
      readFile(new URL("./styles.css", import.meta.url), "utf8"),
      readFile(
        new URL("./collaborative-workspace.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("./workspace-viewport.ts", import.meta.url), "utf8"),
    ]);
    const runtimeProperties = [...`${workspace}\n${viewport}`.matchAll(/"(--[a-z][a-z-]+)"/g)]
      .map(([, property]) => property);

    expect(runtimeProperties).toEqual([
      "--markdown-share-preview-font-scale",
      "--markdown-share-preview-line-height",
      "--markdown-share-app-height",
      "--markdown-share-app-height",
    ]);
    expect(
      runtimeProperties.every((property) => styles.includes(property)),
    ).toBe(true);
  });

  it("sets dark text on every route shell", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toMatch(/\.landing-shell,\s*\.status-shell\s*\{[^}]*color: var\(--markdown-share-ink\);/s);
    expect(styles).toMatch(/\.editor-shell\s*\{[^}]*color: var\(--markdown-share-ink\);/s);
  });

  it("follows the OS dark preference unless light is pinned", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toContain("@media (prefers-color-scheme: dark)");
    expect(styles).toContain(':root:not([data-theme="light"])');
    expect(styles).toContain(':root[data-theme="dark"]');
    expect(styles).toContain(':root[data-theme="light"]');
  });

  it("keeps the rose ramp identical in both themes", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
    const darkBlocks = [
      ...styles.matchAll(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/gs),
      ...styles.matchAll(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/gs),
    ].map(([, block]) => block);

    expect(darkBlocks.length).toBeGreaterThan(0);
    for (const block of darkBlocks) {
      expect(block).not.toContain("--markdown-share-accent:");
      expect(block).not.toContain("--markdown-share-accent-soft:");
    }
  });

  it("defines a dark surface and code palette away from the light look", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toContain("--markdown-share-bg: #161514");
    expect(styles).toContain("--markdown-share-paper: #211f1c");
    expect(styles).toContain("--markdown-share-preview-bg: #1c1a18");
    expect(styles).toContain("--markdown-share-code-bg: #100f0e");
  });

  it("keeps the landing page fluid across desktop and phone widths", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

    expect(styles).toContain("width: min(900px, 100%);");
    expect(styles).toContain("font: 600 clamp(3.2rem, 6vw, 5.25rem)");
    expect(styles).toMatch(/@media \(max-width: 600px\)[\s\S]*?\.filename-row\s*\{\s*grid-template-columns: 1fr;/);
    expect(styles).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.landing-card h1\s*\{\s*font-size: 2.65rem;/);
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
