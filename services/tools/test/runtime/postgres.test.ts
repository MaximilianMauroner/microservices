import { describe, expect, it } from "vitest";
import { rejectInheritedDataEndpoints, requireLoopbackPostgres } from "./postgres.ts";

describe("owned PostgreSQL endpoints", () => {
  it.each(["DATABASE_URL", "TEST_DATABASE_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "S3_ENDPOINT", "TOOLS_S3_BUCKET", "ARTIFACT_S3_ENDPOINT", "DOCKER_HOST", "DOCKER_CONTEXT"])("rejects inherited %s without exposing its value", (name) => {
    expect(() => rejectInheritedDataEndpoints({ [name]: "private-value" })).toThrow(name);
    expect(() => rejectInheritedDataEndpoints({ [name]: "private-value" })).not.toThrow("private-value");
  });

  it("rejects a production process environment", () => {
    expect(() => rejectInheritedDataEndpoints({ NODE_ENV: "production" })).toThrow("BLOCKED production-environment");
  });

  it("accepts a clean environment without a data destination", () => {
    expect(() => rejectInheritedDataEndpoints({ PATH: "/usr/bin", CI: "true" })).not.toThrow();
  });

  it.each([
    "postgres://user:pass@production.example:5432/tools",
    "postgres://user:pass@127.0.0.1:5432/tools?host=production.example",
    "postgres://user:pass@127.0.0.1/tools",
    "https://127.0.0.1:5432/tools",
  ])("rejects an unsafe fixture address %s before connecting", (url) => {
    expect(() => requireLoopbackPostgres(url)).toThrow("BLOCKED postgres-fixture");
  });

  it("accepts an explicit loopback address", () => {
    const url = "postgres://user:pass@127.0.0.1:54623/tools_runtime";
    expect(requireLoopbackPostgres(url)).toBe(url);
  });
});
