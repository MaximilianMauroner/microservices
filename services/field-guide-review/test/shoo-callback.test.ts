import { expect, it } from "vitest";
import { reviewConsole } from "../src/ui.js";

it("preserves and exchanges the Shoo callback before normalizing review navigation", async () => {
  const html = await reviewConsole().text();

  expect(html).toContain('data-shoo-callback-path="/review/callback"');
  expect(html).toContain('data-shoo-auto-callback="false"');
  expect(html).toContain("const callbackUrl=location.origin+'/review/callback'");
  expect(html).toContain(
    "await window.Shoo.startSignIn({redirectUri:callbackUrl,requestPii:true})",
  );
  expect(html).toContain(
    "await window.Shoo.handleCallback({redirectUri:callbackUrl,redirectTo:'/review'})",
  );
  expect(html.indexOf("const callback=window.Shoo.parseCallback()"))
    .toBeLessThan(html.indexOf("updateNavigation();const identity"));
});
