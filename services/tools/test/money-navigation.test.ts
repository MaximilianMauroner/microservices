// @vitest-environment jsdom
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Route } from "../src/routes/money.js";
import { MoneyNav } from "../money/money-tracker-navigation.js";

vi.unmock("@tanstack/react-router");

const mocks = vi.hoisted(() => ({
  data: vi.fn(async ({ data }: { data: { view: string; since?: string } }) => ({ view: data.view })),
  session: vi.fn(async () => ({ subject: "test", email: "test@example.test" })),
  code: vi.fn(async () => undefined),
}));
vi.mock("../src/protected-data.js", () => ({ getMoneyTrackerPageData: mocks.data }));
vi.mock("../src/auth-session.js", () => ({ requireRouteSession: mocks.session }));
vi.mock("../money/money-view-loading.js", () => ({ preloadMoneyView: mocks.code }));
vi.mock("../money/money-tracker-page.js", () => ({ MoneyTrackerPage: () => null }));
vi.mock("../money/money-tracker-pending-page.js", () => ({ MoneyTrackerPendingPage: () => null }));

it("reuses preloaded view data and refreshes it after a mutation without skipping session checks", async () => {
  const root = createRootRoute();
  const money = createRoute({
    getParentRoute: () => root,
    path: "/money",
    validateSearch: Route.options.validateSearch,
    beforeLoad: Route.options.beforeLoad,
    loaderDeps: Route.options.loaderDeps,
    loader: Route.options.loader,
    staleTime: Route.options.staleTime,
    preloadStaleTime: Route.options.preloadStaleTime,
  });
  const router = createRouter({ routeTree: root.addChildren([money]), history: createMemoryHistory({ initialEntries: ["/money?view=spending"] }), isServer: false });
  await router.load();
  expect(mocks.data).toHaveBeenCalledTimes(1);
  await router.preloadRoute({ to: "/money", search: { view: "accounts" } });
  expect(mocks.data).toHaveBeenCalledTimes(2);
  expect(mocks.code).toHaveBeenCalledWith("accounts");
  await router.navigate({ to: "/money", search: { view: "accounts" } });
  expect(mocks.data).toHaveBeenCalledTimes(2);
  expect(mocks.session.mock.calls.length).toBeGreaterThanOrEqual(3);
  await router.navigate({ to: "/money", search: { view: "accounts", category: "shopping" } });
  expect(mocks.data).toHaveBeenCalledTimes(2);
  await router.invalidate();
  expect(mocks.data).toHaveBeenCalledTimes(3);
  await router.navigate({ to: "/money", search: { view: "spending" } });
  expect(mocks.data).toHaveBeenCalledTimes(4);
  await router.navigate({ to: "/money", search: { since: "2026-01-01" } });
  expect(mocks.data).toHaveBeenLastCalledWith({ data: { view: "overview", since: "2026-01-01" } });
});

it("preloads navigation links once and does not repeat session checks while rerendering", async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRootRoute();
  const money = createRoute({
    getParentRoute: () => root, path: "/money",
    validateSearch: Route.options.validateSearch, beforeLoad: Route.options.beforeLoad,
    loaderDeps: Route.options.loaderDeps, loader: Route.options.loader,
    staleTime: Route.options.staleTime, preloadStaleTime: Route.options.preloadStaleTime,
    component: () => createElement(MoneyNav, { current: "overview", reviewCount: 0 }),
  });
  const router = createRouter({ routeTree: root.addChildren([money]), history: createMemoryHistory({ initialEntries: ["/money"] }), isServer: false });
  const host = document.createElement("div");
  document.body.append(host);
  const reactRoot = createRoot(host);
  try {
    await router.load();
    await act(async () => { reactRoot.render(createElement(RouterProvider, { router })); });
    await vi.waitFor(() => expect(mocks.data).toHaveBeenCalledTimes(7));
    const requests = mocks.session.mock.calls.length;
    await act(async () => { await router.navigate({ to: "/money", search: { view: "spending" } }); });
    await act(async () => { await router.navigate({ to: "/money", search: { view: "accounts" } }); });
    expect(mocks.data).toHaveBeenCalledTimes(7);
    expect(mocks.session.mock.calls.length).toBeLessThanOrEqual(requests + 2);
  } finally {
    await act(async () => reactRoot.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
