import { describe, expect, it, vi } from "vitest";
import {
  DISPOSABLE_DATABASE_SENTINEL,
  withVerifiedDisposableDatabase,
} from "./postgres-test-gate.js";

describe("disposable PostgreSQL sentinel", () => {
  it("runs the callback only after the regular-table sentinel matches", async () => {
    expect(DISPOSABLE_DATABASE_SENTINEL).toEqual({
      relation: "field_guide_review_test_sentinel",
      key: "database-purpose",
      value: "field-guide-console-disposable-test-database",
    });
    const order: string[] = [];
    await withVerifiedDisposableDatabase(
      {
        readRelationKind: async () => {
          order.push("relation");
          return "r";
        },
        readValue: async () => {
          order.push("value");
          return DISPOSABLE_DATABASE_SENTINEL.value;
        },
      },
      async () => {
        order.push("push");
      },
    );
    expect(order).toEqual(["relation", "value", "push"]);
  });

  it.each([undefined, "v", "p", "m"])(
    "rejects relation kind %s before reading the row or running the callback",
    async (relationKind) => {
      const readValue = vi.fn(async () => DISPOSABLE_DATABASE_SENTINEL.value);
      const run = vi.fn(async () => undefined);
      await expect(
        withVerifiedDisposableDatabase(
          { readRelationKind: async () => relationKind, readValue },
          run,
        ),
      ).rejects.toThrow("existing regular table");
      expect(readValue).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "wrong-database-purpose"])(
    "rejects sentinel value %s before running the callback",
    async (value) => {
      const run = vi.fn(async () => undefined);
      await expect(
        withVerifiedDisposableDatabase(
          {
            readRelationKind: async () => "r",
            readValue: async () => value,
          },
          run,
        ),
      ).rejects.toThrow("missing or invalid");
      expect(run).not.toHaveBeenCalled();
    },
  );
});
