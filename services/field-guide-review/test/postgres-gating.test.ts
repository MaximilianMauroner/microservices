import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("requires an explicit isolated test database and confirmation marker", async () => {
  const [source, readme] = await Promise.all([
    readFile(new URL("./postgres.integration.test.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  expect(source).toContain("process.env.TEST_DATABASE_URL");
  expect(source).not.toContain("process.env.DATABASE_URL");
  expect(source).toContain(
    'process.env.FIELD_GUIDE_TEST_DATABASE_CONFIRM === "field-guide-review-test"',
  );
  expect(source).toContain("skipIf(!databaseUrl || !databaseConfirmed)");
  expect(source).toContain('"drizzle.postgres.config.ts"');
  expect(source).toContain("TEST_DATABASE_URL: url");
  expect(source).not.toContain("process.env.DATABASE_URL");
  expect(source).not.toContain("DROP TABLE");
  expect(source).toContain("SELECT relation.relkind::text relation_kind");
  expect(source).toContain("FROM public.field_guide_review_test_sentinel");
  expect(source).toContain("if (sentinelAccepted)");
  expect(source).not.toContain(
    "DELETE FROM public.field_guide_review_test_sentinel",
  );

  const verification = source.indexOf(
    "await withVerifiedDisposableDatabase(",
  );
  const push = source.indexOf("await pushSchema(url)", verification);
  expect(verification).toBeGreaterThan(-1);
  expect(push).toBeGreaterThan(verification);
  expect(source.match(/await pushSchema\(url\)/g)).toHaveLength(1);
  expect(readme).toContain(
    "PostgreSQL integration and round-trip tests must use",
  );
  expect(readme).toContain(
    "CREATE TABLE public.field_guide_review_test_sentinel",
  );
  expect(readme).toContain(
    "VALUES ('database-purpose', 'field-guide-review-disposable-test-database')",
  );
  expect(readme).toContain("never point them at production");
});
