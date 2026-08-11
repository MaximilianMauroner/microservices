import { describe, expect, it } from "vitest";
import { nextRevision, persistedJsonValue } from "../src/postgres-store.js";

describe("Postgres checker documents", () => {
  it("unwraps documents affected by the former double-serialization bug", () => {
    expect(persistedJsonValue('{"schemaVersion":5}')).toEqual({ schemaVersion: 5 });
  });

  it("leaves canonical JSONB documents unchanged", () => {
    const document = { schemaVersion: 5 };
    expect(persistedJsonValue(document)).toBe(document);
  });

  it("increments bigint revisions exactly after the JavaScript safe-integer boundary", () => {
    expect(nextRevision(undefined)).toBe("1");
    expect(nextRevision("1111111111111111111")).toBe("1111111111111111112");
  });
});
