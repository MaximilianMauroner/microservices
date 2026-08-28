import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState
} from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { Toaster } from "../components/ui/toast.js";
import { SidebarProvider, SidebarTrigger } from "../components/ui/sidebar.js";
import { ToolsSidebar } from "../components/tools-sidebar.js";
import { ThemeProvider } from "../components/theme-provider.js";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" }
    ]
  }),
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
          <SidebarProvider style={{ "--sidebar-width": "16.5rem" } as CSSProperties}>
            <ToolsSidebar />
            <div className="relative flex w-full min-w-0 flex-1 flex-col bg-background">
              <SidebarTrigger className="fixed left-3 top-3 z-50 md:hidden" />
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
  if (pathname.startsWith("/feedback/f/")) return false;
  return pathname === "/" || ["/documents", "/feedback", "/field-guide", "/money", "/publisher", "/settings", "/status"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
