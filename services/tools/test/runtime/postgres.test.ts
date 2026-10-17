import { afterEach, describe, expect, it, vi } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL } from "../../database/postgres-push-guard.ts";
import { rejectInheritedDataEndpoints, requireLoopbackPostgres } from "./postgres.ts";

const driver = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("postgres", () => ({ default: driver.connect }));

afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe("owned PostgreSQL endpoints", () => {
  it.each(["DATABASE_URL", "TEST_DATABASE_URL", "POSTGRES_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "S3_ENDPOINT", "TOOLS_S3_BUCKET", "ARTIFACT_S3_ENDPOINT", "DOCKER_HOST", "DOCKER_CONTEXT"])("rejects inherited %s without exposing its value", (name) => {
    expect(() => rejectInheritedDataEndpoints({ [name]: "private-value" })).toThrow(name);
    expect(() => rejectInheritedDataEndpoints({ [name]: "private-value" })).not.toThrow("private-value");
  });

  it.each(["NODE_ENV", "TOOLS_ENVIRONMENT"])("rejects production in %s", (name) => {
    expect(() => rejectInheritedDataEndpoints({ [name]: "production" })).toThrow("BLOCKED production-environment");
  });

  it("accepts a clean environment", () => {
    expect(() => rejectInheritedDataEndpoints({ PATH: "/usr/bin", CI: "true", DATABASE_URL: "  " })).not.toThrow();
  });

  it.each([
    "postgres://user:private@production.example:5432/tools",
    "postgres://user:private@127.0.0.1:5432/tools?host=production.example",
    "postgres://user:private@127.0.0.1:5432/tools#production",
    "postgres://user:private@127.0.0.1/tools",
    "postgres://user:private@127.0.0.1:5432/",
    "https://127.0.0.1:5432/tools",
    "private-invalid-url",
  ])("rejects unsafe addresses without exposing credentials", (url) => {
    expect(() => requireLoopbackPostgres(url)).toThrow("BLOCKED postgres-fixture");
    expect(() => requireLoopbackPostgres(url)).not.toThrow("private");
  });

  it.each(["127.0.0.1", "localhost", "[::1]"])("accepts explicit loopback host %s", (host) => {
    const url = `postgres://user:pass@${host}:54623/tools_runtime`;
    expect(requireLoopbackPostgres(url)).toBe(url);
  });
});

describe("PostgreSQL sentinel query child", () => {
  async function verify(kind: string | undefined, value: string | null = DISPOSABLE_DATABASE_SENTINEL.value, unreadable = false) {
    const query = vi.fn(async (strings: TemplateStringsArray) => {
      if (unreadable) throw new Error("private-driver-password");
      if (strings.join("").includes("relkind")) return kind ? [{ kind }] : [];
      return value === null ? [] : [{ value }];
    });
    const end = vi.fn(async () => {});
    driver.connect.mockReturnValue(Object.assign(query, { end }));
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const argv = process.argv;
    const url = process.env.TOOLS_RUNTIME_POSTGRES_URL;
    const exitCode = process.exitCode;
    try {
      process.argv = [process.execPath, "postgres-query.ts", "verify"];
      process.env.TOOLS_RUNTIME_POSTGRES_URL = "postgres://tools_runtime:private-driver-password@127.0.0.1:54321/tools_runtime";
      process.exitCode = 0;
      vi.resetModules();
      await import("./postgres-query.ts");
      return {
        code: process.exitCode,
        stdout: stdout.mock.calls.map(([text]) => text).join(""),
        stderr: stderr.mock.calls.map(([text]) => text).join(""), query, end,
      };
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      if (url === undefined) delete process.env.TOOLS_RUNTIME_POSTGRES_URL;
      else process.env.TOOLS_RUNTIME_POSTGRES_URL = url;
      stdout.mockRestore();
      stderr.mockRestore();
    }
  }

  it("accepts the exact marker in a regular table and closes the connection", async () => {
    const result = await verify("r");
    expect(result).toMatchObject({ code: 0, stdout: "verify\n", stderr: "" });
    expect(result.query).toHaveBeenCalledTimes(2);
    expect(result.end).toHaveBeenCalledOnce();
  });

  it.each([undefined, "v", "m", "f", "p", "S"])("refuses relation kind %s before reading its value", async (kind) => {
    const result = await verify(kind);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("existing regular table");
    expect(result.query).toHaveBeenCalledOnce();
    expect(result.end).toHaveBeenCalledOnce();
  });

  it.each([null, "", "wrong-purpose"])("refuses sentinel value %s", async (value) => {
    const result = await verify("r", value);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("missing or invalid");
    expect(result.end).toHaveBeenCalledOnce();
  });

  it("closes after a driver failure and emits no driver secret", async () => {
    const result = await verify("r", "", true);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("private-driver-password");
    expect(result.end).toHaveBeenCalledOnce();
  });
});
