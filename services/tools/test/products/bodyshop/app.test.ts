import { describe, expect, it } from "vitest";
import type { PlatformPrincipal } from "#security";
import { handleBodyshopActions, handleBodyshopToday } from "../../../products/bodyshop/app.js";
import type { BodyshopStore } from "../../../products/bodyshop/repository.js";

const member: PlatformPrincipal = { role: "member", subject: "member-subject", email: "member@example.test", products: ["bodyshop"] };
const untouched = new Proxy({}, { get: () => { throw new Error("The store must stay closed."); } }) as BodyshopStore;

describe("Bodyshop app API access", () => {
  it("opens only with the app's token and only for a person with Bodyshop", async () => {
    const today = new Request("https://tools.example.test/api/bodyshop/app/today");
    expect((await handleBodyshopToday(today, async () => undefined, untouched)).status).toBe(401);
    expect((await handleBodyshopToday(today, async () => ({ ...member, products: ["kitchen"] }), untouched)).status).toBe(403);
  });

  it("refuses a change the schema does not know before it opens the store", async () => {
    const post = (body: unknown) => new Request("https://tools.example.test/api/bodyshop/app/actions", { method: "POST", body: JSON.stringify(body) });
    expect((await handleBodyshopActions(post({ action: { type: "food.burn" } }), async () => member, untouched)).status).toBe(400);
    expect((await handleBodyshopActions(post({}), async () => member, untouched)).status).toBe(400);
  });
});
