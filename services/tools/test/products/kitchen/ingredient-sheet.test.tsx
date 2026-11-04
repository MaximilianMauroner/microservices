// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Ingredient, Kitchen } from "../../../products/kitchen/domain.js";

const runKitchenAction = vi.hoisted(() => vi.fn(async () => ({ id: "new-ingredient" })));
vi.mock("../../../products/kitchen/server-functions.js", () => ({ runKitchenAction }));
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

it("adds a new ingredient to the recipes a person ticks, with the amount each one needs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<IngredientSheet ingredient="new" newName="Tomatenmark" onClose={() => undefined} data={data} />); });
    const save = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Save")!;
    const box = (name: string) => [...document.querySelectorAll("li")].find((row) => row.textContent?.startsWith(name))!.querySelector<HTMLElement>('[role="checkbox"]')!;

    expect(document.body.textContent).toContain("Add to recipes");
    await act(async () => { box("Curry").click(); });
    expect(save().disabled).toBe(true);
    const amount = document.querySelector<HTMLInputElement>('input[aria-label="Amount for Curry"]')!;
    expect(amount.parentElement!.textContent).toContain("g for 2 servings");

    await act(async () => { type(amount, "1,5"); });
    expect(save().disabled).toBe(false);
    await act(async () => { save().click(); });
    expect(runKitchenAction).toHaveBeenCalledWith({ data: { kitchenId: "kitchen", action: expect.objectContaining({
      type: "ingredient.save", name: "Tomatenmark", addToRecipes: [{ recipeId: "curry", amount: 1.5 }]
    }) } });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("offers an existing ingredient only to the recipes that do not have it yet", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<IngredientSheet ingredient={tomatoes} onClose={() => undefined} data={data} />); });
    const offered = [...document.querySelectorAll("fieldset")].find((set) => set.textContent?.startsWith("Add to recipes"))!;
    expect(offered.textContent).toContain("Curry");
    expect(offered.textContent).not.toContain("Chili");
    expect(document.body.textContent).toContain("Recipes with this ingredient");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
