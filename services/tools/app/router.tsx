import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";
import { routerSsrOptions } from "./router-options.js";
import { parseRouterSearch, stringifyRouterSearch } from "./router-search.js";
import { RoutePendingPage } from "../platform/ui/components/route-pending-page.js";

export function createRouter(nonce?: string) {
  return createTanStackRouter({
    routeTree,
    parseSearch: parseRouterSearch,
    stringifySearch: stringifyRouterSearch,
    defaultPreload: "intent",
    defaultPendingComponent: RoutePendingPage,
    defaultPendingMs: 0,
    defaultPendingMinMs: 250,
    scrollRestoration: true,
    ...routerSsrOptions(nonce)
  });
}

export function getRouter() {
  return createRouter(getGlobalStartContext()?.nonce);
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
