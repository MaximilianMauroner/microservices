import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/components/app-shell.js";
import { Card } from "../src/components/ui/card.js";
import { productAccents } from "../src/product-accent.js";

describe("product accent contract", () => {
  it("exposes every supported accent through the shared shell", () => {
    for (const accent of productAccents) {
      const html = renderToStaticMarkup(<AppShell product={accent} accent={accent} showSignOut={false} />);
      expect(html).toContain('data-suite-accent="' + accent + '"');
    }
  });

  it("uses the shared surface-border token for cards", () => {
    const html = renderToStaticMarkup(<Card>Content</Card>);
    expect(html).toContain("ring-[color:var(--surface-border)]");
  });

  it("allows a product icon to replace the generic shell mark", () => {
    const html = renderToStaticMarkup(<AppShell product="Money" icon="/assets/icons/money.png" showSignOut={false} />);

    expect(html).toContain('src="/assets/icons/money.png"');
    expect(html).not.toContain('aria-hidden="true">M</span>');
  });
});
