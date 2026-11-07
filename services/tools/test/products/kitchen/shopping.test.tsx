// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ExtraItem, Kitchen, ShoppingLine } from "../../../products/kitchen/domain.js";
import type { KitchenAction } from "../../../products/kitchen/actions.js";

const mocks = vi.hoisted(() => ({ run: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../../products/kitchen/server-functions.js", () => ({ runKitchenAction: mocks.run }));
vi.mock("../../../platform/ui/components/ui/use-mobile.js", () => ({ useIsMobile: () => false }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: mocks.invalidate, preloadRoute: async () => undefined }),
  Link: ({ children }: { children: unknown }) => children
}));

const { KitchenShoppingPage } = await import("../../../products/kitchen/ui/shopping.js");
const { Toaster } = await import("../../../platform/ui/components/ui/toast.js");

const kitchen: Kitchen = { id: "kitchen", name: "Home", groups: [], members: [], hidden: false, mcpEnabled: false };
const item: ExtraItem = { id: "b8b91f59-2f48-43bc-a2be-99e64124459f", name: "Yoghurt", everyWeek: false, bought: false };
const button = (label: string) => [...document.querySelectorAll("button")].find((one) => one.textContent?.trim() === label || one.getAttribute("aria-label") === label);

afterEach(() => vi.resetAllMocks());

async function show(extras: ExtraItem[], check: () => Promise<void>, lines: ShoppingLine[] = []) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () => root.render(<Toaster timeout={0}><KitchenShoppingPage
    kitchen={kitchen} kitchens={[kitchen]} isAdmin today="2026-11-02" plannedMeals={0} ingredients={[]}
    shopping={{ start: "2026-11-02", lines, extras: [...extras] }}
  /></Toaster>);
  mocks.invalidate.mockImplementation(async () => render());
  mocks.run.mockImplementation(async ({ data: { action } }: { data: { action: KitchenAction } }) => {
    if (action.type === "extra.remove") extras = extras.filter((extra) => extra.id !== action.id);
    if (action.type === "extra.add") extras.push({ ...item, id: action.createId ?? `restored-${extras.length}`, name: action.name, everyWeek: action.everyWeek ?? false, boughtWeek: action.boughtWeek, bought: !!action.everyWeek && action.boughtWeek === "2026-11-02" });
    if (action.type === "extra.mark") extras = extras.map((extra) => extra.id === action.id ? { ...extra, bought: action.bought } : extra);
    return {};
  });
  try {
    await act(async () => render());
    await check();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
}

it("consumes Undo once, even when it is clicked twice before the action completes", () => show([item], async () => {
  await act(async () => button("Bought Yoghurt")!.click());
  const undo = button("Undo")!;
  expect(undo).toBeDefined();
  await act(async () => { undo.click(); undo.click(); });
  expect(mocks.run.mock.calls.filter(([request]) => request.data.action.type === "extra.add")).toHaveLength(1);
  expect(document.querySelectorAll('[aria-label="Bought Yoghurt"]')).toHaveLength(1);
  expect(button("Undo")).toBeUndefined();
}));

it("allows a weekly item to be bought again after Undo", () => show([{ ...item, everyWeek: true }], async () => {
  await act(async () => button("Bought Yoghurt")!.click());
  expect(button("Bought Yoghurt")!.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Undo")!.click());
  expect(button("Bought Yoghurt")!.getAttribute("aria-pressed")).toBe("false");
  await act(async () => button("Bought Yoghurt")!.click());
  expect(mocks.run).toHaveBeenLastCalledWith({ data: { kitchenId: "kitchen", action: { type: "extra.mark", id: item.id, week: "2026-11-02", bought: true } } });
}));

it.each([false, true])("removes an extra item and restores its weekly setting with Undo, everyWeek=%s", (everyWeek) => show([{ ...item, everyWeek }], async () => {
  expect(button("Remove Yoghurt")).toBeDefined();
  await act(async () => button("Remove Yoghurt")!.click());
  expect(button("Bought Yoghurt")).toBeUndefined();
  expect(document.body.textContent).toContain("Yoghurt removed");
  await act(async () => button("Undo")!.click());
  expect(button("Bought Yoghurt")).toBeDefined();
  expect(mocks.run).toHaveBeenLastCalledWith({ data: { kitchenId: "kitchen", action: { type: "extra.add", createId: item.id, name: "Yoghurt", everyWeek } } });
}));

it("offers one retry after Undo fails and consumes that retry once", () => show([item], async () => {
  await act(async () => button("Bought Yoghurt")!.click());
  mocks.run.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => button("Undo")!.click());
  expect(button("Undo")).toBeUndefined();
  expect(document.body.textContent).toContain("Connection lost");
  const retry = button("Try again")!;
  expect(retry).toBeDefined();
  await act(async () => { retry.click(); retry.click(); });
  expect(mocks.run.mock.calls.filter(([request]) => request.data.action.type === "extra.add")).toHaveLength(2);
  expect(document.querySelectorAll('[aria-label="Bought Yoghurt"]')).toHaveLength(1);
  expect(button("Try again")).toBeUndefined();
}));

it("dismisses a purchase notification with its close button", () => show([item], async () => {
  await act(async () => button("Bought Yoghurt")!.click());
  await act(async () => button("Close toast")!.click());
  expect(button("Undo")).toBeUndefined();
  expect(mocks.run).toHaveBeenCalledTimes(1);
}));

async function enterItem(name: string) {
  await act(async () => button("Add item")!.click());
  const input = document.querySelector<HTMLInputElement>('[aria-label="Item"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

it("keeps a failed shopping item in the form", () => show([], async () => {
  const input = await enterItem("Coffee");
  mocks.run.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => button("Add")!.click());
  expect(input.value).toBe("Coffee");
}));

it("ignores another form submission while an item is being added", () => show([], async () => {
  const input = await enterItem("Coffee");
  let finish!: (value: object) => void;
  mocks.run.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => button("Add")!.click());
  await act(async () => input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(input.disabled).toBe(true);
  await act(async () => finish({}));
  expect(input.value).toBe("");
}));

it("dismisses the old retry when a failed item is submitted again", () => show([], async () => {
  await enterItem("Coffee");
  mocks.run.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => button("Add")!.click());
  const staleRetry = button("Try again")!;
  expect(staleRetry).toBeDefined();
  await act(async () => { button("Add")!.click(); staleRetry.click(); });
  expect(button("Try again")).toBeUndefined();
  expect(document.querySelectorAll('[aria-label="Bought Coffee"]')).toHaveLength(1);
}));

it("keeps a saved ingredient purchase checked when refreshing the list fails", () => show([], async () => {
  mocks.invalidate.mockRejectedValueOnce(new Error("Refresh unavailable"));
  const buy = button("Bought Rice, 100 g")!;
  expect(buy).toBeDefined();
  await act(async () => buy.click());
  expect(document.body.textContent).toContain("Refresh unavailable");
  expect(buy.disabled).toBe(true);
  await act(async () => buy.click());
  expect(mocks.run).toHaveBeenCalledTimes(1);
}, [{ ingredientId: "rice", ingredient: "Rice", unit: "g", section: "Grains", needed: 100, inStock: 0, toBuy: 100, recipes: ["Curry"] }]));

it.each(["2026-11-02", "2026-10-26"])("restores a weekly item's bought week %s after Remove and Undo", (boughtWeek) => show([{ ...item, everyWeek: true, boughtWeek, bought: boughtWeek === "2026-11-02" }], async () => {
  await act(async () => button("Remove Yoghurt")!.click());
  await act(async () => button("Undo")!.click());
  expect(mocks.run).toHaveBeenLastCalledWith({ data: { kitchenId: "kitchen", action: {
    type: "extra.add", createId: item.id, name: item.name, everyWeek: true, boughtWeek
  } } });
  expect(button("Bought Yoghurt")!.getAttribute("aria-pressed")).toBe(String(boughtWeek === "2026-11-02"));
}));
