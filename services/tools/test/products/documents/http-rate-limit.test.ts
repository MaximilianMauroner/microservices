import { describe, expect, it } from "vitest";
import { createShareHandler } from "../../../products/documents/http.js";

const origin = "https://tools.example.test";
type Handler = Parameters<typeof createShareHandler>;

describe("document creation limit", () => {
  it("refuses new documents from one client after 30 in an hour and still serves other clients", async () => {
    const owners: string[] = [];
    const repository = { create: async (_input: unknown, owner: string) => { owners.push(owner); return { token: "t" }; } } as unknown as Handler[0];
    const handle = createShareHandler(repository, {} as Handler[1], origin, async () => "anonymous");
    const create = (address: string) => handle(new Request(`${origin}/api/share/documents`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "cf-connecting-ip": address },
      body: JSON.stringify({ requestId: crypto.randomUUID(), filename: "a.md", format: "markdown", markdown: "" })
    }));
    for (let i = 0; i < 30; i++) expect((await create("203.0.113.7")).status).toBe(200);
    const refused = await create("203.0.113.7");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect((await create("198.51.100.2")).status).toBe(200);
    expect(owners).toHaveLength(31);
  });
});
