import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("integrated Markdown Share theme", () => {
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

  it("prints the preview without hiding application mount ancestors", async () => {
    const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
    const printStyles = styles.slice(styles.indexOf("@media print"));

    expect(printStyles).not.toContain("#root");
    expect(printStyles).toContain(".editor-shell > :not(.workspace)");
    expect(printStyles).toContain(".editor-shell .workspace > :not(.preview-panel)");
    expect(printStyles).toContain(".editor-shell .preview-panel > :not(#print-preview)");
  });
});
