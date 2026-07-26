import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("requires an explicit isolated test database and confirmation marker", async () => {
  const source = await readFile(
    new URL("./postgres.integration.test.ts", import.meta.url),
    "utf8",
  );
  expect(source).toContain("process.env.TEST_DATABASE_URL");
  expect(source).not.toContain("process.env.DATABASE_URL");
  expect(source).toContain(
    'process.env.FIELD_GUIDE_TEST_DATABASE_CONFIRM === "field-guide-review-test"',
  );
  expect(source).toContain("skipIf(!databaseUrl || !databaseConfirmed)");
  expect(source).toContain('["run", "db:push"]');
  expect(source).toContain("DATABASE_URL: url");
  expect(source).not.toContain("process.env.DATABASE_URL");
  expect(source).not.toContain("DROP TABLE");
});
