import { PLATFORM_UI_BUILD } from "../build-identity.js";
import { Link } from "@tanstack/react-router";
import type { ProductAccent } from "../product-accent.js";
import { favicons } from "../favicons.js";

export function AppShell({ product, showSignOut, accent, icon }: { product: string; showSignOut: boolean; accent?: ProductAccent; icon?: string }) {
  return (
    <>
      <a className="suite-skip skip-link" href="#main">Skip to content</a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm" data-suite-shell="orbit" data-suite-accent={accent} data-ui-build={PLATFORM_UI_BUILD}>
        <div className="mx-auto flex h-14 w-[min(1380px,calc(100%_-_2rem))] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link className="flex items-center gap-2 text-sm font-semibold" to="/" preload="intent" aria-label="Tools dashboard">
              {icon
                ? <img className="size-8 rounded-lg" src={icon} alt="" width={32} height={32} />
                : <img className="size-8 rounded-lg" src={favicons.directory} alt="" width={32} height={32} />}
              <span>Tools</span>
            </Link>
            <span className="text-muted-foreground/45" aria-hidden="true">·</span>
            <span className="truncate text-xs font-semibold text-muted-foreground">{product}</span>
          </div>
          {showSignOut ? <span className="sr-only">Account actions are in the sidebar</span> : null}
        </div>
      </header>
    </>
  );
}
