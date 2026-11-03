import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState
} from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { Toaster } from "../../platform/ui/components/ui/toast.js";
import { SidebarProvider } from "../../platform/ui/components/ui/sidebar.js";
import { ToolsSidebar } from "../../platform/ui/components/tools-sidebar.js";
import { ThemeProvider } from "../../platform/ui/components/theme-provider.js";
import { getCurrentPrincipal } from "../../platform/auth/session.js";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" }
    ]
  }),
  loader: () => getCurrentPrincipal(),
  staleTime: Infinity,
  component: RootDocument
});

function RootDocument() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hasWorkspaceSidebar = isWorkspacePath(pathname);

  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>{hasWorkspaceSidebar ? (
          <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
            <ToolsSidebar />
            <div className="relative flex w-full min-w-0 flex-1 flex-col bg-background">
              <Outlet />
              <Toaster />
            </div>
          </SidebarProvider>
        ) : (
          <><Outlet /><Toaster /></>
        )}</ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

export function isWorkspacePath(pathname: string) {
  if (pathname.startsWith("/feedback/f/") || pathname.startsWith("/feedback/share/") || pathname === "/feedback/confirmation" || pathname === "/share" || pathname.startsWith("/share/") || pathname === "/markdown" || pathname.startsWith("/markdown/")) return false;
  return pathname === "/" || ["/bodyshop", "/documents", "/feedback", "/kitchen", "/money", "/publisher", "/settings", "/status"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
