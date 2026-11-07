import { createHmac } from "node:crypto";
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { parseRouterSearch, stringifyRouterSearch } from "../../app/router-search.js";

function signature(params: URLSearchParams): string {
  const signed = new URLSearchParams(params);
  signed.delete("sig");
  const canonical = new URLSearchParams([...signed].sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return createHmac("sha256", "test-secret").update(canonical.toString()).digest("base64");
}

describe("router search parameters", () => {
  it.each(["/sign-in", "/consent"])("keeps the OAuth signature valid on %s", (path) => {
    const original = new URLSearchParams({
      client_id: "com.lab4code.pantrino",
      redirect_uri: "com.lab4code.pantrino:/oauth",
      scope: "openid profile email offline_access",
      state: "00123",
      nonce: '"quoted"',
      exp: "1794044797"
    });
    for (const key of [...original.keys(), "ba_param"]) original.append("ba_param", key);
    original.set("sig", signature(original));

    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: [`${path}?${original}`] }),
      parseSearch: parseRouterSearch,
      stringifySearch: stringifyRouterSearch
    });
    const url = new URL(router.buildLocation({ to: path, search: (search) => search }).href, "https://tools.test");
    expect(signature(url.searchParams)).toBe(original.get("sig"));
    expect(url.searchParams.getAll("ba_param")).toEqual(original.getAll("ba_param"));
    expect(url.searchParams.get("state")).toBe("00123");
    expect(url.searchParams.get("nonce")).toBe('"quoted"');
  });

  it("keeps typed search parameters for ordinary product pages", () => {
    const search = { page: 2, archived: false, groups: ["pantry", "fridge"], query: "123" };
    expect(parseRouterSearch(stringifyRouterSearch(search))).toEqual(search);
  });
});
