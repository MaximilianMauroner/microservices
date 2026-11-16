// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), personal: vi.fn(), admin: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../../products/kitchen/server-functions.js", () => ({ runKitchenAction: mocks.run, runKitchenPersonalAction: mocks.personal, runKitchenAdminAction: mocks.admin }));
vi.mock("../../../platform/ui/components/ui/use-mobile.js", () => ({ useIsMobile: () => false }));
vi.mock("../../../platform/ui/components/app-shell.js", () => ({ AppShell: () => null }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate, preloadRoute: async () => undefined }),
  Link: ({ children }: { children: unknown }) => children
}));

const { useKitchenAction } = await import("../../../products/kitchen/ui/kit.js");
const { KitchensPage } = await import("../../../products/kitchen/ui/kitchens.js");
const { Toaster } = await import("../../../platform/ui/components/ui/toast.js");

function Action() {
  const { run } = useKitchenAction("kitchen");
  return <button onClick={() => void run({ type: "stock.add", ingredientId: "rice", amount: 100 }, { title: "Rice added" })}>Add rice</button>;
}

const button = (label: string) => [...document.querySelectorAll("button")].find((one) => one.textContent === label);
afterEach(() => vi.resetAllMocks());

async function show(element: React.ReactElement, check: () => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.run.mockResolvedValue({});
  mocks.personal.mockResolvedValue({});
  mocks.admin.mockResolvedValue({});
  mocks.invalidate.mockResolvedValue(undefined);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Toaster timeout={0}>{element}</Toaster>));
    await check();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
}

it("retries only the refresh when an action saved but refreshing the page failed", () => show(<Action />, async () => {
  mocks.invalidate.mockRejectedValueOnce(new Error("Refresh unavailable"));
  await act(async () => button("Add rice")!.click());
  expect(document.body.textContent).toContain("Rice added");
  expect(document.body.textContent).toContain("Refresh unavailable");
  await act(async () => button("Try again")!.click());
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.invalidate).toHaveBeenCalledTimes(2);
  expect(button("Try again")).toBeUndefined();
}));

const kitchens = <KitchensPage kitchens={[{ id: "kitchen", name: "Home", mcpEnabled: false, hidden: false, members: [], groups: [] }]} isAdmin={false} people={[]} hiddenKitchens={[]} />;

it("consumes a failed kitchen setting retry only once", () => show(kitchens, async () => {
  mocks.personal.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => document.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  const retry = button("Try again")!;
  expect(retry).toBeDefined();
  await act(async () => { retry.click(); retry.click(); });
  expect(mocks.personal).toHaveBeenCalledTimes(2);
  expect(button("Try again")).toBeUndefined();
}));

it("retries only the refresh after a kitchen setting was saved", () => show(kitchens, async () => {
  mocks.invalidate.mockRejectedValueOnce(new Error("Refresh unavailable"));
  await act(async () => document.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  await act(async () => button("Try again")!.click());
  expect(mocks.personal).toHaveBeenCalledTimes(1);
  expect(mocks.invalidate).toHaveBeenCalledTimes(2);
}));

it("dismisses a stale setting retry after a new setting action", () => show(kitchens, async () => {
  mocks.personal.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => document.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(button("Try again")).toBeDefined();
  await act(async () => document.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(button("Try again")).toBeUndefined();
  expect(mocks.personal).toHaveBeenCalledTimes(2);
}));

it("asks before removing a kitchen member", () => show(<KitchensPage kitchens={[{ id: "kitchen", name: "Home", mcpEnabled: false, hidden: false, members: [{ personId: "person", email: "cook@example.test" }], groups: [] }]} isAdmin people={[]} hiddenKitchens={[]} />, async () => {
  const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove cook@example.test from Home"]')!;
  await act(async () => remove.click());
  expect(document.body.textContent).toContain("Remove cook@example.test from Home?");
  await act(async () => button("Cancel")!.click());
  expect(mocks.admin).not.toHaveBeenCalled();
  await act(async () => remove.click());
  await act(async () => button("Remove cook@example.test from Home")!.click());
  expect(mocks.admin).toHaveBeenCalledWith({ data: { type: "member.remove", kitchenId: "kitchen", personId: "person" } });
}));
