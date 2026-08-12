import { PLATFORM_UI_BUILD } from "../build-identity.js";
import { Link } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client.js";
import type { ProductAccent } from "../product-accent.js";
import { favicons } from "../favicons.js";

export function AppShell({ product, showSignOut, accent, icon }: { product: string; showSignOut: boolean; accent?: ProductAccent; icon?: string }) {
  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

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
          <nav className="flex items-center gap-1" aria-label={`${product} session`}>
            {showSignOut ? (
              <button
                className="inline-flex h-11 items-center rounded-full border px-3 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground sm:h-8"
                type="button"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            ) : null}
          </nav>
        </div>
      </header>
    </>
  );
}
