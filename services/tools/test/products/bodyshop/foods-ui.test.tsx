// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FoodsPage } from "../../../products/bodyshop/ui/foods.js";
import type { SavedFood } from "../../../products/bodyshop/domain.js";

const run = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));
vi.mock("../../../products/bodyshop/server-functions.js", () => ({ runBodyshopAction: run }));
vi.mock("../../../platform/ui/components/ui/use-mobile.js", () => ({ useIsMobile: () => false }));
vi.mock("../../../platform/ui/components/ui/toast.js", () => ({ toast: { add: vi.fn() } }));
const food: SavedFood = { id: "food-1", name: "Oats", brand: "", amount: 100, unit: "g", nutrients: { kcal: 380, protein: 13, carbs: 60, fat: 7, fiber: 10 }, notes: "", fullSize: null, container: "", fullSizeNotes: "", source: "", sourceReference: "", verified: null, confidence: "", range: null, fiberRange: null, fiberNotes: "" };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("asks before removing a saved food and preserves it when cancelled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  run.mockResolvedValue({});
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(<FoodsPage foods={[food]} />));
    await act(async () => [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Oats"))!.click());
    await act(async () => button("Remove…").click());
    expect(document.body.textContent).toContain("Remove Oats?");
    expect(run).not.toHaveBeenCalled();
    await act(async () => button("Cancel").click());
    expect(run).not.toHaveBeenCalled();
    await act(async () => button("Remove…").click());
    await act(async () => button("Remove food").click());
    expect(run).toHaveBeenCalledWith({ data: { type: "remove", kind: "food", id: "food-1" } });
  } finally { await act(async () => root.unmount()); host.remove(); }
});
