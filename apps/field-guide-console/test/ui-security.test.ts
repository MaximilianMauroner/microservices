import { expect, it } from "vitest";
import { reviewConsole } from "../src/ui.js";

it("uses Cloudflare Access and nonce CSP with attribute escaping", async () => {
  const response = reviewConsole();
  const html = await response.text();
  expect(html).not.toContain("requestPii:true");
  expect(html).toContain("&quot;");
  expect(response.headers.get("content-security-policy")).toContain("nonce-");
  expect(response.headers.get("content-security-policy")).not.toContain(
    "unsafe-inline",
  );
  expect(html).not.toContain('nonce="${nonce}"');
});
