import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { TOOLS_PRODUCTS, currentProduct } from "../src/components/tools-nav.js";

describe("private Tools navigation", () => {
  it("opens the Markdown Share editor with document navigation because it is a separate app", async () => {
    const markdown = TOOLS_PRODUCTS.find((product) => product.id === "markdown");
    expect(markdown?.pages?.find((page) => page.to === "/markdown")?.external).toBe(true);
    const sidebar = await readFile(new URL("../src/components/tools-sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar).toContain("page.external ? <a href={page.to}");
  });

  it("lists each page once and finds the product for nested routes", () => {
    const pages = TOOLS_PRODUCTS.flatMap((product) => product.pages?.map((page) => page.to) ?? [product.to]);
    expect(new Set(pages).size).toBe(pages.length);
    expect(currentProduct("/feedback/forms/abc")?.id).toBe("feedback");
    expect(currentProduct("/publisher/artifacts")?.id).toBe("publisher");
    expect(currentProduct("/documents")?.id).toBe("markdown");
  });
});
