import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("only offers more history when the server reports another page", async () => {
  const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");

  expect(source).toContain("hasMore?'<button id=\"load-more\"");
  expect(source).toContain("state.cursor=data.nextCursor||null");
  expect(source).toContain("loadMore.addEventListener('click',()=>loadReviews(true))");
  expect(source).toContain("decision.projectDisplayName||decision.projectKey");
});
