import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../database/001_runtime_schemas.sql", import.meta.url);

describe("runtime schema migration", () => {
  it("fails instead of silently accepting duplicate Field Guide relations", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("and to_regclass('field_guide.' || relation_name) is not null then");
    expect(migration).toContain("raise exception 'refusing to move public.%: field_guide.% already exists'");
    expect(migration).toContain("elsif to_regclass('public.' || relation_name) is not null then");
  });
});
