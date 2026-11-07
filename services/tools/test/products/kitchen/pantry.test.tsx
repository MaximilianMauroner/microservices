// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Ingredient, Kitchen, StockItem } from "../../../products/kitchen/domain.js";

const mocks = vi.hoisted(() => ({ run: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../../products/kitchen/server-functions.js", () => ({ runKitchenAction: mocks.run }));
vi.mock("../../../platform/ui/components/ui/use-mobile.js", () => ({ useIsMobile: () => false }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate, preloadRoute: async () => undefined }),
  Link: ({ children }: { children: unknown }) => children
}));

const { KitchenPantryPage } = await import("../../../products/kitchen/ui/pantry.js");
const { Toaster } = await import("../../../platform/ui/components/ui/toast.js");

const kitchen: Kitchen = { id: "kitchen", name: "Home", groups: [], members: [], hidden: false, mcpEnabled: false };
const ingredient: Ingredient = { id: "tomatoes", name: "Tomatoes", unit: "piece", section: "Gemüse", otherGroups: [], nutrition: { kcal: null, protein: null, carbs: null, fat: null }, notes: "", recipeCount: 0 };
const stock: StockItem = { ingredientId: ingredient.id, ingredient: ingredient.name, unit: ingredient.unit, section: ingredient.section, amount: 12 };
const input = () => document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;

afterEach(() => vi.resetAllMocks());

async function show(check: () => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mocks.run.mockResolvedValue({});
  mocks.invalidate.mockResolvedValue(undefined);
  try {
    await act(async () => root.render(<Toaster timeout={0}><KitchenPantryPage
      kitchen={kitchen} kitchens={[kitchen]} isAdmin today="2026-11-02" ingredients={[ingredient]}
      recipes={[]} stock={[stock]} leftovers={[]}
    /></Toaster>));
    await check();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
}

async function edit(value: string) {
  await act(async () => {
    input().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input().blur());
}

it.each(["", "  "])("keeps stock unchanged when its amount is cleared to %j", (value) => show(async () => {
  await edit(value);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(input().value).toBe("12");
}));

it("restores the saved amount after an edit fails", () => show(async () => {
  mocks.run.mockRejectedValueOnce(new Error("Connection lost"));
  await edit("24");
  expect(mocks.run).toHaveBeenCalledWith({ data: { kitchenId: "kitchen", action: { type: "stock.set", ingredientId: ingredient.id, amount: 24 } } });
  expect(input().value).toBe("12");
  expect(document.body.textContent).toContain("Connection lost");
}));

it("disables amount editing while its change is pending", () => show(async () => {
  let finish!: (value: object) => void;
  mocks.run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await edit("24");
  expect(input().disabled).toBe(true);
  await act(async () => finish({}));
  expect(input().disabled).toBe(false);
}));

it("still accepts an explicit zero amount", () => show(async () => {
  await edit("0");
  expect(mocks.run).toHaveBeenCalledWith({ data: { kitchenId: "kitchen", action: { type: "stock.set", ingredientId: ingredient.id, amount: 0 } } });
}));
