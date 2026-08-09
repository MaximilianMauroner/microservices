/** @typedef {"tools" | "publish" | "review" | "status" | "manage"} SuiteDestination */

/** @type {ReadonlyArray<{id: SuiteDestination, href: string, label: string}>} */
const destinations = [
  { id: "tools", href: "/", label: "Tools" },
  { id: "publish", href: "/publish", label: "Publish" },
  { id: "review", href: "/review", label: "Review" },
  { id: "status", href: "/status", label: "Status" },
  { id: "manage", href: "/manage", label: "Manage" }
];

/**
 * @param {SuiteDestination} active
 * @returns {string}
 */
export function renderSuiteChrome(active) {
  const renderLinks = () => destinations.map((destination) =>
    `<a href="${destination.href}"${destination.id === active ? ' aria-current="page"' : ""}>${destination.label}</a>`
  ).join("");
  const links = renderLinks();
  return `<a class="suite-skip skip-link" href="#main">Skip to content</a>
    <header class="suite-header" data-suite-shell="command-deck">
      <div class="suite-header__inner">
        <a class="suite-brand" href="/" aria-label="Mauroner Tools home"><span aria-hidden="true">M</span>Mauroner Tools</a>
        <nav class="suite-nav" aria-label="Mauroner Tools">${links}</nav>
        <details class="suite-menu">
          <summary>Menu</summary>
          <nav aria-label="Mauroner Tools mobile">${renderLinks()}</nav>
        </details>
      </div>
    </header>`;
}

/** Canonical framework-neutral tokens and primitives for every suite surface. */
export const suiteChromeStyles = String.raw`
:root {
  color-scheme: dark;
  --background: #000;
  --foreground: #fafafa;
  --card: #09090b;
  --card-foreground: #fafafa;
  --popover: #09090b;
  --popover-foreground: #fafafa;
  --primary: #fafafa;
  --primary-foreground: #09090b;
  --secondary: #18181b;
  --secondary-foreground: #fafafa;
  --muted: #18181b;
  --muted-foreground: #a1a1aa;
  --accent: #18181b;
  --accent-foreground: #fafafa;
  --destructive: #7f1d1d;
  --destructive-foreground: #fecaca;
  --border: #27272a;
  --input: #27272a;
  --ring: #d4d4d8;
  --success: #4ade80;
  --warning: #facc15;
  --danger: #f87171;
  --radius: 8px;
  --control-radius: 6px;
  --shell: 1160px;
  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ink: var(--foreground);
  --paper: var(--background);
  --surface: var(--card);
  --line: var(--border);
  --accent-soft: var(--secondary);
  --blue: #93c5fd;
  --amber: var(--warning);
  --amber-soft: #2a2405;
  --red: var(--danger);
  --red-soft: #2b0b0b;
  --shadow: none;
  --sans: var(--font-sans);
}
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--background); }
body { min-width: 320px; margin: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-synthesis: none; }
button, input, select, textarea { font: inherit; }
button, summary, a { -webkit-tap-highlight-color: transparent; }
[hidden] { display: none !important; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.suite-skip { position: fixed; z-index: 100; top: 8px; left: 8px; padding: 8px 12px; transform: translateY(-160%); border-radius: var(--control-radius); background: var(--primary); color: var(--primary-foreground); font-size: 13px; font-weight: 650; }
.suite-skip:focus { transform: translateY(0); }
.suite-header { position: relative; z-index: 40; border-bottom: 1px solid var(--border); background: #050505; color: var(--foreground); }
.suite-header__inner { width: min(calc(100% - 48px), var(--shell)); min-height: 56px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.suite-brand { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 9px; color: var(--foreground); font-size: 13px; font-weight: 750; text-decoration: none; }
.suite-brand > span { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid var(--primary); border-radius: 7px; background: var(--primary); color: var(--primary-foreground); font-size: 12px; font-weight: 900; }
.suite-nav { display: flex; min-width: 0; align-items: center; gap: 2px; }
.suite-nav a, .suite-menu nav a { display: inline-flex; min-height: 36px; align-items: center; gap: 7px; padding: 0 10px; border-radius: var(--control-radius); color: var(--muted-foreground); font-size: 12px; font-weight: 650; text-decoration: none; }
.suite-nav a:hover, .suite-menu nav a:hover { background: var(--accent); color: var(--accent-foreground); }
.suite-nav a[aria-current="page"], .suite-menu nav a[aria-current="page"] { background: var(--secondary); color: var(--secondary-foreground); }
.suite-menu { display: none; position: relative; }
.suite-menu summary { min-height: 36px; display: inline-flex; align-items: center; padding: 0 11px; border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--secondary); color: var(--foreground); cursor: pointer; font-size: 12px; font-weight: 650; list-style: none; }
.suite-menu summary::-webkit-details-marker { display: none; }
.suite-menu nav { position: absolute; top: 43px; right: 0; width: min(280px, calc(100vw - 24px)); padding: 6px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--popover); box-shadow: 0 18px 48px rgba(0,0,0,.6); }
.suite-menu nav a { width: 100%; justify-content: space-between; }
.button, .button-primary, .button-secondary, .button-quiet { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--secondary); color: var(--secondary-foreground); font-size: 12px; font-weight: 650; line-height: 1; text-decoration: none; cursor: pointer; }
.button:hover, .button-secondary:hover, .button-quiet:hover { background: #202023; }
.button--primary, .button-primary { border-color: var(--primary); background: var(--primary); color: var(--primary-foreground); }
.button--primary:hover, .button-primary:hover { background: #e4e4e7; }
.button--danger { color: var(--danger); }
.button:disabled, .button-primary:disabled, .button-secondary:disabled, .button-quiet:disabled { cursor: not-allowed; opacity: .5; }
input, select, textarea { border: 1px solid var(--input); border-radius: var(--control-radius); background: #050505; color: var(--foreground); }
input::placeholder, textarea::placeholder { color: #71717a; }
input:focus-visible, select:focus-visible, textarea:focus-visible { border-color: var(--ring); outline: 1px solid var(--ring); outline-offset: 0; }
@media (max-width: 700px) {
  .suite-header__inner { width: calc(100% - 24px); min-height: 52px; align-items: center; flex-direction: row; gap: 12px; padding: 0; }
  .suite-brand { padding-left: 0; }
  .suite-nav { display: none; }
  .suite-menu { display: block; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`;
