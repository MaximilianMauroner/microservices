import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serviceDirectory = fileURLToPath(new URL("..", import.meta.url));

function loadConfig(databaseUrl?: string) {
  const env = { ...process.env };
  if (databaseUrl === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = databaseUrl;
  return spawnSync("bun", ["-e", 'import("./drizzle.config.ts")'], {
    cwd: serviceDirectory,
    encoding: "utf8",
    env,
  });
}

describe("Drizzle config", () => {
  it.each([
    [undefined, "non-empty PostgreSQL URL"],
    ["not-a-url", "valid PostgreSQL URL"],
    ["https://database.example/field-guide", "valid PostgreSQL URL"],
    ["postgresql://database.example/", "valid PostgreSQL URL"],
  ])("fails closed for %s", (databaseUrl, message) => {
    const result = loadConfig(databaseUrl);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it.each([
    "postgres://database.example/field-guide",
    "postgresql://database.example/field-guide",
  ])("accepts a non-empty PostgreSQL URL without connecting: %s", (databaseUrl) => {
    const result = loadConfig(databaseUrl);
    expect(result.status, result.stderr).toBe(0);
  });
});
