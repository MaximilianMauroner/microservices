import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { containsTransactionControl } from "../src/postgres-repository.js";

describe("migration transaction guard", () => {
  it.each([
    "BEGIN; SELECT 1;",
    "START TRANSACTION; SELECT 1;",
    "COMMIT;",
    "ROLLBACK;",
    "ABORT;",
    "SAVEPOINT before_change;",
    "RELEASE before_change;",
    "RELEASE SAVEPOINT before_change;",
    "-- migration header\nBEGIN;",
    "SELECT 1; /* coordinate */ START TRANSACTION;",
  ])("rejects transaction control: %s", (sql) => {
    expect(containsTransactionControl(sql)).toBe(true);
  });

  it("ignores control-like words inside tagged and untagged dollar bodies", () => {
    expect(
      containsTransactionControl(`
        CREATE FUNCTION example() RETURNS void AS $body$
        BEGIN
          PERFORM 'START TRANSACTION; SAVEPOINT nested';
        END
        $body$ LANGUAGE plpgsql;
        DO $$
        BEGIN
          RAISE NOTICE 'ROLLBACK; ABORT; RELEASE SAVEPOINT';
        END
        $$;
      `),
    ).toBe(false);
  });

  it("accepts the shipped transaction-free migrations", async () => {
    for (const name of ["001_initial.sql", "002_decision_amendments.sql"]) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
      expect(containsTransactionControl(sql), name).toBe(false);
    }
  });
});
