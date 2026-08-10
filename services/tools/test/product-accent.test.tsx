import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/components/app-shell.js";
import { productAccents } from "../src/product-accent.js";

describe("product accent contract", () => {
  it("exposes every supported accent through the shared shell", () => {
    for (const accent of productAccents) {
      const html = renderToStaticMarkup(<AppShell product={accent} accent={accent} showSignOut={false} />);
      expect(html).toContain('data-suite-accent="' + accent + '"');
    }
  });
});
