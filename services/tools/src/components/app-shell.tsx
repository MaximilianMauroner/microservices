import { PLATFORM_UI_BUILD } from "../build-identity.js";
import { Link } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client.js";

export function AppShell({ product, showSignOut }: { product: string; showSignOut: boolean }) {
  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  return (
    <>
      <a className="suite-skip skip-link" href="#main">Skip to content</a>
      <header className="sticky top-0 z-40 border-b bg-black/95" data-suite-shell="orbit" data-ui-build={PLATFORM_UI_BUILD}>
        <div className="mx-auto flex h-14 w-[min(1180px,calc(100%_-_2rem))] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link className="flex items-center gap-2 text-sm font-semibold" to="/" preload="intent" aria-label="Tools dashboard">
              <span className="grid size-8 place-items-center rounded-full bg-lime-300 text-xs font-black text-black" aria-hidden="true">M</span>
              <span>Tools</span>
            </Link>
            <span className="text-zinc-700" aria-hidden="true">·</span>
            <span className="truncate text-xs font-semibold text-zinc-300">{product}</span>
          </div>
          <nav className="flex items-center gap-1" aria-label={`${product} session`}>
            {showSignOut ? (
              <button
                className="inline-flex h-8 items-center rounded-full border border-zinc-800 px-3 text-xs font-semibold text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900 hover:text-white"
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
