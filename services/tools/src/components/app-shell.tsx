import { PLATFORM_UI_BUILD } from "../build-identity.js";
import { Link } from "@tanstack/react-router";
import { Sun } from "lucide-react";
import { authClient } from "../lib/auth-client.js";

export function AppShell({ product, showSignOut }: { product: string; showSignOut: boolean }) {
  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("tools-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#f3f5f8" : "#1b1e28");
  }

  return (
    <>
      <a className="suite-skip skip-link" href="#main">Skip to content</a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm" data-suite-shell="orbit" data-ui-build={PLATFORM_UI_BUILD}>
        <div className="mx-auto flex h-14 w-[min(1180px,calc(100%_-_2rem))] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link className="flex items-center gap-2 text-sm font-semibold" to="/" preload="intent" aria-label="Tools dashboard">
              <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-black text-primary-foreground" aria-hidden="true">M</span>
              <span>Tools</span>
            </Link>
            <span className="text-muted-foreground/45" aria-hidden="true">·</span>
            <span className="truncate text-xs font-semibold text-muted-foreground">{product}</span>
          </div>
          <nav className="flex items-center gap-1" aria-label={`${product} session`}>
            <button
              className="grid size-8 place-items-center rounded-full border text-muted-foreground hover:bg-accent hover:text-foreground"
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color mode"
              title="Toggle color mode"
            >
              <Sun className="size-4" aria-hidden="true" />
            </button>
            {showSignOut ? (
              <button
                className="inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
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
