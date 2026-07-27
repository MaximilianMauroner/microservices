export const DISPOSABLE_DATABASE_SENTINEL = {
  relation: "field_guide_review_test_sentinel",
  key: "database-purpose",
  value: "field-guide-console-disposable-test-database",
} as const;

type SentinelLookups = {
  readRelationKind: () => Promise<string | undefined>;
  readValue: () => Promise<string | undefined>;
};

export async function withVerifiedDisposableDatabase(
  lookups: SentinelLookups,
  run: () => Promise<void>,
) {
  const relationKind = await lookups.readRelationKind();
  if (relationKind !== "r") {
    throw new Error(
      "Disposable database sentinel must be an existing regular table.",
    );
  }
  const value = await lookups.readValue();
  if (value !== DISPOSABLE_DATABASE_SENTINEL.value) {
    throw new Error("Disposable database sentinel value is missing or invalid.");
  }
  await run();
}
