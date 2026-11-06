// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Ingredient, Kitchen } from "../../../products/kitchen/domain.js";

const runKitchenAction = vi.hoisted(() => vi.fn(async () => ({ id: "new-ingredient" })));
const searchKitchenCatalog = vi.hoisted(() => vi.fn(async ({ data }: { data: { query: string } }) => data.query.toLowerCase().startsWith("kicher")
  ? [{ code: "9001", name: "Kichererbsen", brand: "Spar", quantity: "400 g", unit: "g" as const, nutrition: { kcal: 120, protein: 7.2, carbs: 15, fat: 2.6 } }]
  : []));
vi.mock("../../../products/kitchen/server-functions.js", () => ({ runKitchenAction, searchKitchenCatalog }));
vi.mock("../../../platform/ui/components/ui/use-mobile.js", () => ({ useIsMobile: () => false }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: async () => undefined, preloadRoute: async () => undefined }),
  Link: ({ children }: { children: unknown }) => children
}));

const { IngredientSheet } = await import("../../../products/kitchen/ui/ingredients.js");

const kitchen = { id: "kitchen", name: "Home", groups: [] } as unknown as Kitchen;
const tomatoes: Ingredient = { id: "tomatoes", name: "Tomatoes", unit: "piece", section: "Gemüse", otherGroups: [], nutrition: { kcal: null, protein: null, carbs: null, fat: null }, notes: "", recipeCount: 1 };
const data = {
  kitchen, kitchens: [kitchen], isAdmin: true, today: "2026-11-04", ingredients: [tomatoes],
  recipes: [
    { id: "chili", name: "Chili", servings: 4, ingredientIds: ["tomatoes"] },
    { id: "curry", name: "Curry", servings: 2, ingredientIds: [] }
  ]
};

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const button = (label: string) => [...document.querySelectorAll("button")].find((one) => one.textContent === label || one.getAttribute("aria-label") === label)!;
const search = () => document.querySelector<HTMLInputElement>('input[type="search"]')!;

async function show(element: React.ReactElement, check: () => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(element); });
    await check();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
}

it("puts a new ingredient into the recipes a person finds, with the amount each one needs", () => show(
  <IngredientSheet ingredient="new" newName="Tomatenmark" onClose={() => undefined} data={data} />,
  async () => {
    await act(async () => { button("Add Gemüse").click(); });
    await act(async () => { type(search(), "cur"); });
    await act(async () => { button("Curry").click(); });
    expect(button("Save").disabled).toBe(true);
    expect(document.body.textContent).toContain("Enter how much each recipe needs.");

    await act(async () => { type(document.querySelector<HTMLInputElement>('input[aria-label="Amount for Curry"]')!, "1,5"); });
    expect(button("Save").disabled).toBe(false);
    await act(async () => { button("Save").click(); });
    expect(runKitchenAction).toHaveBeenCalledWith({ data: { kitchenId: "kitchen", action: expect.objectContaining({
      type: "ingredient.save", name: "Tomatenmark", section: "Gemüse", otherGroups: [], addToRecipes: [{ recipeId: "curry", amount: 1.5 }]
    }) } });
  }
));

it("offers an existing ingredient only to the recipes that do not have it yet", () => show(
  <IngredientSheet ingredient={tomatoes} onClose={() => undefined} data={data} />,
  async () => {
    expect(document.querySelector('ul[aria-label="Recipes with this ingredient"]')!.textContent).toContain("Chili");
    await act(async () => { type(search(), "chili"); });
    expect(document.body.textContent).toContain("No other recipe matches “chili”");
  }
));

it("fills a new ingredient from a product that matches its typed name", () => show(
  <IngredientSheet ingredient="new" newName="" onClose={() => undefined} data={data} />,
  async () => {
    vi.useFakeTimers();
    try {
      const name = document.querySelector<HTMLInputElement>("#ingredient-name")!;
      await act(async () => { type(name, "kicher"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(searchKitchenCatalog).toHaveBeenCalledWith({ data: { query: "kicher" } });
      await act(async () => { [...document.querySelectorAll("button")].find((one) => one.textContent?.startsWith("Kichererbsen"))!.click(); });

      expect(name.value).toBe("Kichererbsen");
      expect(document.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toBe("g");
      expect(document.body.textContent, "the list goes away after a pick").not.toContain("Fill in from a product");
      await act(async () => { button("Save").click(); });
      expect(runKitchenAction).toHaveBeenLastCalledWith({ data: { kitchenId: "kitchen", action: expect.objectContaining({
        type: "ingredient.save", name: "Kichererbsen", unit: "g", kcal: 120, protein: 7.2, carbs: 15, fat: 2.6
      }) } });
    } finally {
      vi.useRealTimers();
    }
  }
));
