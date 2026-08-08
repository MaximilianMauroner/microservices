import {
  DISPOSABLE_DATABASE_SENTINEL,
  verifyDisposableDatabase,
} from "../src/postgres-push-guard.js";

export { DISPOSABLE_DATABASE_SENTINEL };

type SentinelLookups = {
  readRelationKind: () => Promise<string | undefined>;
  readValue: () => Promise<string | undefined>;
};

export async function withVerifiedDisposableDatabase(
  lookups: SentinelLookups,
  run: () => Promise<void>,
) {
  await verifyDisposableDatabase(lookups);
  await run();
}
