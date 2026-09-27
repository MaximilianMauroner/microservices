import { Link, useRouterState } from "@tanstack/react-router";
import { MenuIcon } from "lucide-react";
import { PLATFORM_UI_BUILD } from "../build-identity.js";
import type { ProductAccent } from "../product-accent.js";
import { favicons } from "../favicons.js";
import { currentProduct } from "./tools-nav.js";
import { Button } from "./ui/button.js";
import { useOptionalSidebar } from "./ui/sidebar.js";

/**
 * Page chrome for every Tools page. On desktop the sidebar is the only navigation, so the bar is hidden;
 * it stays in the document because its accent marker themes the page.
 */
export function AppShell({ product, accent, icon }: { product: string; accent?: ProductAccent; icon?: string }) {
  const sidebar = useOptionalSidebar();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const pages = currentProduct(pathname)?.pages?.filter((page) => !page.external);
  return (
    <>
      <a className="suite-skip skip-link" href="#main">Skip to content</a>
      <header className="sticky top-0 z-40 border-b bg-sidebar md:hidden" data-suite-shell="orbit" data-suite-accent={accent} data-ui-build={PLATFORM_UI_BUILD}>
        <div className="flex h-13 items-center gap-2 px-2">
          {sidebar ? <Button variant="ghost" size="icon" onClick={sidebar.toggleSidebar} aria-label="Open navigation"><MenuIcon /></Button> : null}
          <img className="size-6 rounded-md" src={icon ?? favicons.directory} alt="" width={24} height={24} />
          <span className="truncate text-sm font-semibold">{product}</span>
        </div>
        {pages ? (
          <nav className="flex gap-1 overflow-x-auto border-t px-2 py-1.5 [scrollbar-width:none]" aria-label={`${product} pages`}>
            {pages.map((page) => (
              <Link
                key={page.to}
                to={page.to}
                preload="intent"
                aria-current={page.match(pathname) ? "page" : undefined}
                className="inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-medium text-muted-foreground aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground"
              >
                {page.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>
    </>
  );
}
