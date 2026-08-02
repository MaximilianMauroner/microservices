export const PUSH_AUTHORIZATION = "field-guide-console-authorized-schema-push";

export const DISPOSABLE_DATABASE_SENTINEL = {
  relation: "field_guide_review_test_sentinel",
  key: "database-purpose",
  value: "field-guide-console-disposable-test-database",
} as const;

export type PushMode = "production" | "test";

type Environment = Record<string, string | undefined>;

type SentinelLookups = {
  readRelationKind: () => Promise<string | undefined>;
  readValue: () => Promise<string | undefined>;
};

export function resolvePushDatabase(environment: Environment, mode: PushMode) {
  const variable = mode === "production" ? "DATABASE_URL" : "TEST_DATABASE_URL";
  const confirmationVariable = mode === "production"
    ? "FIELD_GUIDE_SCHEMA_PUSH_CONFIRM"
    : "FIELD_GUIDE_TEST_DATABASE_CONFIRM";
  const confirmationValue = mode === "production"
    ? "field-guide-console-production"
    : "field-guide-console-test";
  const url = environment[variable]?.trim();
  if (!url) throw new Error(`${variable} is required for the ${mode} PostgreSQL schema push.`);
  if (environment[confirmationVariable] !== confirmationValue) {
    throw new Error(`${mode === "production" ? "Production" : "Disposable test"} schema push requires ${confirmationVariable}=${confirmationValue}.`);
  }
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === "/") {
    throw new Error(`${variable} must be a valid PostgreSQL URL.`);
  }
  return url;
}

export async function verifyDisposableDatabase(lookups: SentinelLookups) {
  if (await lookups.readRelationKind() !== "r") {
    throw new Error("Disposable database sentinel must be an existing regular table.");
  }
  if (await lookups.readValue() !== DISPOSABLE_DATABASE_SENTINEL.value) {
    throw new Error("Disposable database sentinel value is missing or invalid.");
  }
}
