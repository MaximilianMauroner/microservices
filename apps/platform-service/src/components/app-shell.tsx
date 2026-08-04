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
      <header className="suite-header" data-suite-shell="command-deck">
        <div className="suite-header__inner">
          <a className="suite-brand" href="/" aria-label="Mauroner Tools home">
            <span aria-hidden="true">M</span>
            Mauroner Tools
          </a>
          <nav className="suite-nav" aria-label="Mauroner Tools">
            {destinations.map((destination) => (
              <a
                key={destination.id}
                href={destination.href}
                aria-current={destination.id === active ? "page" : undefined}
              >
                {destination.label}
                {destination.protected ? (
                  <>
                    <span className="suite-lock" aria-hidden="true" />
                    <span className="visually-hidden">, Cloudflare Access protected</span>
                  </>
                ) : null}
              </a>
            ))}
          </nav>
        </div>
      </header>
    </>
  );
}
