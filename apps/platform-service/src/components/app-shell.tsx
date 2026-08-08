import { PLATFORM_UI_BUILD } from "../build-identity.js";
import { Link, useLocation } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client.js";

type Destination = "tools" | "publish" | "review" | "status" | "manage";

const destinations: ReadonlyArray<{
  id: Destination;
  href: string;
  label: string;
  protected: boolean;
}> = [
  { id: "tools", href: "/", label: "Tools", protected: false },
  { id: "publish", href: "/publish", label: "Publish", protected: true },
  { id: "review", href: "/review", label: "Review", protected: true },
  { id: "status", href: "/status", label: "Status", protected: false },
  { id: "manage", href: "/manage", label: "Manage", protected: true }
];

export function AppShell({ active }: { active: Destination }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const privateView = destinations.find((destination) => destination.id === active)?.protected ||
    pathname.startsWith("/manage") || pathname.startsWith("/tools/private");

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  return (
    <>
      <a className="suite-skip skip-link" href="#main">Skip to content</a>
      <header className="sticky top-0 z-40 border-b bg-black/95 backdrop-blur supports-[backdrop-filter]:bg-black/85" data-suite-shell="task-focused" data-ui-build={PLATFORM_UI_BUILD}>
        <div className="mx-auto flex h-14 w-[min(1180px,calc(100%_-_2rem))] items-center justify-between gap-4">
          <Link className="flex items-center gap-2 text-sm font-semibold" to="/" preload="intent" aria-label="Mauroner Tools home">
            <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-black text-background" aria-hidden="true">M</span>
            <span className="hidden sm:inline">Mauroner Tools</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Mauroner Tools">
            {destinations.map((destination) => (
              <Link
                key={destination.id}
                to={destination.href}
                preload="intent"
                activeOptions={{ exact: true }}
                aria-current={destination.id === active ? "page" : undefined}
                className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-secondary aria-[current=page]:text-foreground"
              >
                {destination.label}
              </Link>
            ))}
            {privateView ? (
              <button
                className="ml-1 inline-flex h-8 items-center rounded-md border border-zinc-800 px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
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
