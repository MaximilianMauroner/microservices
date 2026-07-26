import { expect, it } from "vitest";
import { reviewConsole } from "../src/ui.js";

it("ships syntactically valid review console JavaScript", async () => {
  const html = await reviewConsole().text();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(() => new Function(script!)).not.toThrow();
});
