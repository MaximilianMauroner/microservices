import { describe, expect, it, vi } from "vitest";
import type { PlatformPrincipal } from "#security";
import { handleBodyshopActions, handleBodyshopToday } from "../../../products/bodyshop/app.js";
import { handleBodyshopHealth } from "../../../products/bodyshop/health.js";
import type { BodyshopStore } from "../../../products/bodyshop/repository.js";
import type { BodyshopAppSnapshot } from "../../../products/bodyshop/snapshot.js";

const member: PlatformPrincipal = { role: "member", subject: "member-subject", email: "member@example.test", products: ["bodyshop"] };
const untouched = new Proxy({}, { get: () => { throw new Error("The store must stay closed."); } }) as BodyshopStore;

describe("Bodyshop app API access", () => {
  it("opens only with the app's token and only for a person with Bodyshop", async () => {
    const today = new Request("https://tools.example.test/api/bodyshop/app/today");
    expect((await handleBodyshopToday(today, async () => undefined, untouched)).status).toBe(401);
    expect((await handleBodyshopToday(today, async () => ({ ...member, products: ["kitchen"] }), untouched)).status).toBe(403);
    const health = new Request("https://tools.example.test/api/bodyshop/app/health");
    expect((await handleBodyshopHealth(health, async () => undefined, untouched)).status).toBe(401);
    expect((await handleBodyshopHealth(health, async () => ({ ...member, products: ["kitchen"] }), untouched)).status).toBe(403);
  });

  it("returns the latest 181 days for Insights while the log displays a different day", async () => {
    const rows = [
      { day: "2026-05-03", steps: 8000, sleep: 8 },
      { day: "2026-05-04", steps: 7000, sleep: 7 },
      { day: "2026-09-01", steps: 6000, sleep: 8 },
      { day: "2026-09-02", steps: 4000, sleep: 8 },
      { day: "2026-10-02", steps: 0, sleep: null },
      { day: "2026-10-31", steps: null, sleep: 7.5 },
      { day: "2026-11-01", steps: 9000, sleep: 9 },
    ];
    const store = {
      owner(subject: string) {
        expect(subject).toBe(member.subject);
        return {
          async list(kind: string, range?: { from: string; to: string }) {
            return kind === "checkin" ? rows.filter(({ day }) => !range || day >= range.from && day <= range.to) : [];
          },
        };
      },
    } as unknown as BodyshopStore;
    const request = new Request("https://tools.example.test/api/bodyshop/app/today?day=2026-10-02");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    try {
      const response = await handleBodyshopToday(request, async () => member, store);
      expect(response.status).toBe(200);
      const snapshot = await response.json() as BodyshopAppSnapshot;
      expect(snapshot.day).toBe("2026-10-02");
      expect(snapshot.energy).toMatchObject({ state: "Building", closedThrough: "2026-10-30", tdeeMid: null });
      expect(snapshot.trends?.map(({ day, steps, sleep, status }) => ({ day, steps, sleep, status }))).toEqual([
        { day: "2026-05-04", steps: 7000, sleep: 7, status: "Unknown" },
        { day: "2026-09-01", steps: 6000, sleep: 8, status: "Unknown" },
        { day: "2026-09-02", steps: 4000, sleep: 8, status: "Unknown" },
        { day: "2026-10-02", steps: 0, sleep: null, status: "Unknown" },
        { day: "2026-10-31", steps: null, sleep: 7.5, status: "Unknown" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a change the schema does not know before it opens the store", async () => {
    const post = (body: unknown) => new Request("https://tools.example.test/api/bodyshop/app/actions", { method: "POST", body: JSON.stringify(body) });
    expect((await handleBodyshopActions(post({ action: { type: "food.burn" } }), async () => member, untouched)).status).toBe(400);
    expect((await handleBodyshopActions(post({}), async () => member, untouched)).status).toBe(400);
  });
});
