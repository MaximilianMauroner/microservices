import { expect, it } from "vitest";
import { reviewConsole } from "../src/ui.js";

it("uses the platform browser session without a second OAuth callback", async () => {
  const html = await reviewConsole().text();

  expect(html).toContain("state.token='browser-session'");
  expect(html).toContain("fetch('/api/auth/sign-out',{method:'POST'})");
});
