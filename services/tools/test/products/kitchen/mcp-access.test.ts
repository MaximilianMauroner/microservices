import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, it, vi } from "vitest";
import type { PlatformPrincipal } from "#security";
import type { Kitchen } from "../../../products/kitchen/domain.js";
import { registerKitchenTools } from "../../../products/kitchen/mcp-tools.js";
import type { KitchenStore } from "../../../products/kitchen/repository.js";

it("hides disabled kitchens and denies reads, writes, and copies to them", async () => {
  let enabled = false;
  const home: Kitchen = { id: "home", name: "Home", mcpEnabled: true, groups: [], members: [] };
  const privateKitchen: Kitchen = { ...home, id: "private", name: "Private", mcpEnabled: false };
  const store: KitchenStore = {
    list: vi.fn(async () => [{ ...home, mcpEnabled: enabled }, privateKitchen]),
    open: vi.fn(),
    admin: vi.fn(),
    copyRecipe: vi.fn(),
    readiness: vi.fn(),
    close: vi.fn(),
  };
  const server = new McpServer({ name: "kitchen-test", version: "1.0.0" });
  registerKitchenTools(server, store, { role: "admin", subject: "admin", email: "admin@example.test", products: ["kitchen"] } as PlatformPrincipal);
  const client = new Client({ name: "kitchen-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  try {
    expect(await call("kitchen_list")).toMatchObject({ content: [{ text: "[]" }] });
    for (const kitchen of [undefined, "home", "Home", "private", "Private"]) {
      expect(await call("recipe_list", { kitchen })).toMatchObject({ isError: true });
      expect(await call("shopping_add", { kitchen, item: "Milk" })).toMatchObject({ isError: true });
    }
    expect(store.open).not.toHaveBeenCalled();
    enabled = true;
    const list = await call("kitchen_list");
    expect(JSON.parse((list.content as { text: string }[])[0]!.text)).toEqual([home]);
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("kitchen_mcp");
    expect(await call("recipe_copy", { kitchen: "home", recipe: "Soup", toKitchen: "private" })).toMatchObject({ isError: true });
    expect(store.copyRecipe).not.toHaveBeenCalled();
    enabled = false;
    expect(await call("recipe_list", { kitchen: "home" })).toMatchObject({ isError: true });
    expect(await call("kitchen_list")).toMatchObject({ content: [{ text: "[]" }] });
    expect(store.admin).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await server.close();
  }
});
