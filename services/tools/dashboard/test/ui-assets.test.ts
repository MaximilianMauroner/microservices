import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const assets = new URL("../public/assets/", import.meta.url);
const icons = new URL("icons/", assets);

describe("static UI assets", () => {
  test("tool icons remain canonical 96px PNG assets", async () => {
    for (const name of ["publisher", "money", "status", "markdown-share", "network-console"]) {
      const image = await readFile(new URL(`${name}.png`, icons));

      expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(image.readUInt32BE(16)).toBe(96);
      expect(image.readUInt32BE(20)).toBe(96);
    }
  });

  test("favicon assets retain an alpha channel for rounded corners", async () => {
    for (const name of ["tools", "publisher", "money", "status", "markdown-share", "network-console"]) {
      const image = await readFile(new URL(`${name}.png`, icons));

      expect(image[25]).toBe(6);
    }
  });

  test("styles expose keyboard focus and respect reduced motion", async () => {
    const css = await readFile(new URL("tools.css", assets), "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(":focus-visible");
  });

  test("keeps the shared navigation and hero usable at compact widths", async () => {
    const css = await readFile(new URL("tools.css", assets), "utf8");

    expect(css).toContain("@media (max-width: 439px)");
    expect(css).toContain(".suite-nav { width: 100%; flex-wrap: wrap; overflow-x: visible;");
    expect(css).toContain(".suite-nav a { flex: 1 1 calc(33.333% - 4px);");
    expect(css).toContain("font-size: 2.125rem");
    expect(css).toContain(".browse-tools { margin-top: 14px;");
    expect(css).toContain(".directory-primary-action");
    expect(css).toContain(".directory-action");
    expect(css).toContain(".uptime-bar-scroll");
    expect(css).toContain("min-width: 540px");
  });
});
