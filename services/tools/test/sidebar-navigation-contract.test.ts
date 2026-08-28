import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("private Tools navigation", () => {
  it("uses document navigation for Markdown Share only", async () => {
    const [sidebar, directory] = await Promise.all([
      readFile(new URL("../src/components/tools-sidebar.tsx", import.meta.url), "utf8"),
      readFile(new URL("../dashboard/ui/tools-directory.tsx", import.meta.url), "utf8"),
    ]);

    expect(sidebar).toContain('item.to === "/markdown" ? <a href={item.to} /> : <Link to={item.to} preload="intent" />');
    expect(directory).toContain('product.id === "markdown-share"');
    expect(directory).toContain('<a key={product.id} href={product.href}>{card}</a>');
    expect(directory).toContain('<Link key={product.id} to={product.href as');
  });
});
