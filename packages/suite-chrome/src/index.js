/** @typedef {"tools" | "publish" | "review" | "status" | "manage"} SuiteDestination */

/** @type {ReadonlyArray<{id: SuiteDestination, href: string, label: string, protected: boolean}>} */
const destinations = [
  { id: "tools", href: "/", label: "Tools", protected: false },
  { id: "publish", href: "/publish", label: "Publish", protected: true },
  { id: "review", href: "/review", label: "Review", protected: true },
  { id: "status", href: "/status", label: "Status", protected: false },
  { id: "manage", href: "/manage", label: "Manage", protected: true }
];

/**
 * @param {SuiteDestination} active
 * @returns {string}
 */
export function renderSuiteChrome(active) {
  const links = destinations.map((destination) => {
    const access = destination.protected
      ? '<span class="suite-lock" aria-hidden="true"></span><span class="visually-hidden">, Cloudflare Access protected</span>'
      : "";
    return `<a href="${destination.href}"${destination.id === active ? ' aria-current="page"' : ""}>${destination.label}${access}</a>`;
  }).join("");
  return `<a class="suite-skip skip-link" href="#main">Skip to content</a>
    <header class="suite-header" data-suite-shell="command-deck">
      <div class="suite-header__inner">
        <a class="suite-brand" href="/" aria-label="Mauroner Tools home"><span aria-hidden="true">M</span>Mauroner Tools</a>
        <nav class="suite-nav" aria-label="Mauroner Tools">${links}</nav>
      </div>
    </header>`;
}
