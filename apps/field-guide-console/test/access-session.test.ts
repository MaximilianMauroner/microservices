import { expect, it } from "vitest";
import { reviewConsole } from "../src/ui.js";

it("uses Cloudflare Access without a second OAuth callback", async () => {
  const html = await reviewConsole().text();

  expect(html).toContain("state.token='cloudflare-access'");
  expect(html).toContain("location.assign('/cdn-cgi/access/logout')");
});
