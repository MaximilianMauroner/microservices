// @vitest-environment jsdom
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { expect, it, vi } from "vitest";
import { Route } from "../src/routes/money.js";

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
