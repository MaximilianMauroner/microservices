import { PLATFORM_UI_BUILD } from "../build-identity.js";

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
  return (
    <>
      <a className="suite-skip skip-link" href="#main">Skip to content</a>
      <header className="sticky top-0 z-40 border-b bg-black/95 backdrop-blur supports-[backdrop-filter]:bg-black/85" data-suite-shell="task-focused" data-ui-build={PLATFORM_UI_BUILD}>
        <div className="mx-auto flex h-14 w-[min(1180px,calc(100%_-_2rem))] items-center justify-between gap-4">
          <a className="flex items-center gap-2 text-sm font-semibold" href="/" aria-label="Mauroner Tools home">
            <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-black text-background" aria-hidden="true">M</span>
            <span className="hidden sm:inline">Mauroner Tools</span>
          </a>
          <nav className="flex items-center gap-1" aria-label="Mauroner Tools">
            {destinations.map((destination) => (
              <a
                key={destination.id}
                href={destination.href}
                aria-current={destination.id === active ? "page" : undefined}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-secondary aria-[current=page]:text-foreground"
              >
                {destination.label}
                {destination.protected ? (
                  <span className="size-1 rounded-full bg-muted-foreground" title="Access protected"><span className="visually-hidden">, Cloudflare Access protected</span></span>
                ) : null}
              </a>
            ))}
          </nav>
        </div>
      </header>
    </>
  );
}
