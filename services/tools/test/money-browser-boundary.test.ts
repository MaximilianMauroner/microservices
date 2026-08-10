import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const clientRoots = [
  new URL("../money/money-ledger-views.tsx", import.meta.url),
  new URL("../money/money-tracker-page.tsx", import.meta.url)
];
const serverOnlyModules = new Set([
  fileURLToPath(new URL("../money/money-import-domain.ts", import.meta.url)),
  fileURLToPath(new URL("../money/sparkasse-xlsx.ts", import.meta.url))
]);

describe("money browser boundary", () => {
  it("keeps server-only statement parsers outside the complete client graph", () => {
    const visited = new Set<string>();
    const pending = clientRoots.map((url) => fileURLToPath(url));

    while (pending.length) {
      const filename = pending.pop()!;
      if (visited.has(filename)) continue;
      visited.add(filename);
      expect(serverOnlyModules.has(filename), `${filename} is server-only`).toBe(false);
      for (const specifier of runtimeImports(readFileSync(filename, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const dependency = resolveSourceModule(filename, specifier);
        if (dependency) pending.push(dependency);
      }
    }
  });

  it("recognizes every runtime module edge used by the client graph", () => {
    expect(runtimeImports(`
      import type { Preview } from "./types.js";
      export type { Result } from "./results.js";
      import "./side-effect.js";
      import { value } from "./static.js";
      export { shared } from "./barrel.js";
      void import("./dynamic.js");
    `)).toEqual(["./side-effect.js", "./static.js", "./barrel.js", "./dynamic.js"]);
  });
});

function runtimeImports(source: string) {
  return [
    ...source.matchAll(/\bimport\s+(?!type\b)(?:[^"'`;]*?\bfrom\s*)?["']([^"']+)["']/g),
    ...source.matchAll(/\bexport\s+(?!type\b)[^"'`;]*?\bfrom\s*["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)
  ].sort((left, right) => left.index - right.index).map((match) => match[1]!);
}

function resolveSourceModule(importer: string, specifier: string) {
  const unresolved = new URL(specifier, `file://${importer}`).pathname.replace(/\.js$/, "");
  return [`.ts`, `.tsx`].map((extension) => `${unresolved}${extension}`).find(existsSync);
}
