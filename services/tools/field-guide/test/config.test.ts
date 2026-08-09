import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://localhost/field_guide",
  AGENT_API_TOKEN: "secret",
  PUBLIC_BASE_URL: "https://reviews.example",
};

describe("configuration", () => {
  it("requires PostgreSQL", () => {
    expect(loadConfig(base)).toMatchObject({
      databaseUrl: base.DATABASE_URL,
      publicBaseUrl: base.PUBLIC_BASE_URL,
    });
    expect(() => loadConfig({ ...base, DATABASE_URL: "" })).toThrow("DATABASE_URL");
  });

  it.each(["ftp://reviews.example", "https://user:pass@reviews.example", "https://reviews.example/path", "https://reviews.example/?x=1", "https://reviews.example/#x"])(
    "rejects %s",
    (value) => expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: value })).toThrow("HTTP(S) origin"),
  );
});
