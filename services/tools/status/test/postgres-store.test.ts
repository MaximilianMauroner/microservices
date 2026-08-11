import { describe, expect, it } from "vitest";
import { persistedJsonValue } from "../src/postgres-store.js";

describe("Postgres checker documents", () => {
  it("unwraps documents affected by the former double-serialization bug", () => {
    expect(persistedJsonValue('{"schemaVersion":5}')).toEqual({ schemaVersion: 5 });
  });

  it("leaves canonical JSONB documents unchanged", () => {
    const document = { schemaVersion: 5 };
    expect(persistedJsonValue(document)).toBe(document);
  });
});
