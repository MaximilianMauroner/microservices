// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Kitchen, PlanEntry } from "../../../products/kitchen/domain.js";

const runKitchenAction = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("../../../products/kitchen/server-functions.js", () => ({ runKitchenAction }));
vi.mock("../../../platform/ui/components/ui/use-mobile.js", () => ({ useIsMobile: () => false }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: async () => undefined, preloadRoute: async () => undefined }),
  Link: ({ children }: { children: unknown }) => children
}));

const { KitchenWeekPage } = await import("../../../products/kitchen/ui/week.js");
const { Toaster } = await import("../../../platform/ui/components/ui/toast.js");
const kitchen: Kitchen = { id: "kitchen", name: "Home", groups: [], members: [], mcpEnabled: false, hidden: false };
const button = (label: string) => [...document.querySelectorAll("button")].find((one) => one.textContent?.trim() === label)!;

it.each([false, true])("keeps the original meal id, custom lines, and cooking timestamp in Undo, cooked=%s", async (cooked) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runKitchenAction.mockClear();
  const entry: PlanEntry = {
    id: "5701c920-5a5b-4729-8117-48d960e60b79", day: "2026-11-02", meal: "dinner", recipeId: "recipe", recipe: "Pasta", servings: 2,
    custom: true, cooked, cookedAt: cooked ? "2026-11-02T18:25:00.000Z" : null,
    lines: [{ ingredientId: "pasta", ingredient: "Spaghetti", unit: "g", amount: 150, note: "less pasta" }]
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Toaster timeout={0}><KitchenWeekPage
      kitchen={kitchen} kitchens={[kitchen]} isAdmin today="2026-11-02" ingredients={[]} recipes={[]} leftovers={[]} toBuy={0} buySections={[]}
      week={{ start: "2026-11-02", entries: [entry] }}
    /></Toaster>));
    await act(async () => [...document.querySelectorAll("button")].find((one) => one.textContent?.includes("Pasta"))!.click());
    await act(async () => button("Remove").click());
    expect(runKitchenAction).toHaveBeenLastCalledWith({ data: { kitchenId: kitchen.id, action: { type: "plan.remove", id: entry.id } } });
    await act(async () => button("Undo").click());
    expect(runKitchenAction).toHaveBeenLastCalledWith({ data: { kitchenId: kitchen.id, action: {
      type: "plan.add", createId: entry.id, day: entry.day, meal: entry.meal, recipeId: entry.recipeId, servings: entry.servings,
      restore: { cookedAt: entry.cookedAt, lines: [{ ingredientId: "pasta", amount: 150, note: "less pasta" }] }
    } } });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
