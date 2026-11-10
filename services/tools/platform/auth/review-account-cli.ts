import { readFileSync } from "node:fs";
import postgres from "postgres";
import { provisionReviewAccount, reviewProvisionTarget } from "./provision-review-account.js";
import { DISPOSABLE_DATABASE_SENTINEL, verifyDisposableDatabase } from "../database/postgres-push-guard.js";

async function run() {
  const [operation, mode, input, ...extra] = process.argv.slice(2);
  if (!["provision", "revoke"].includes(operation ?? "") || extra.length || (input && input !== "--password-stdin") || (operation === "revoke" && input)) {
    throw new Error("Usage: review-account-cli.ts provision|revoke test|development|production [--password-stdin]");
  }
  const target = reviewProvisionTarget(process.env, mode);
  const password = input === "--password-stdin" ? readFileSync(0, "utf8").replace(/\r?\n$/, "") : process.env.APP_REVIEW_PASSWORD;
  if (operation === "provision" && !password) throw new Error("Provide APP_REVIEW_PASSWORD or --password-stdin.");
  const sql = postgres(target.url, { max: 1, connect_timeout: 5 });
  try {
    if (target.mode === "test") await verifyDisposableDatabase({
      readRelationKind: async () => (await sql<{ kind: string }[]>`
        select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
      readValue: async () => (await sql<{ value: string }[]>`select sentinel_value value from public.tools_runtime_test_sentinel where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value
    });
    await provisionReviewAccount(sql, operation === "provision" ? { kind: "provision", password: password! } : { kind: "revoke" });
    process.stdout.write(operation === "provision" ? "App Review account provisioned. Existing review sessions and tokens revoked.\n" : "App Review access revoked.\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

try {
  await run();
} catch {
  process.stderr.write("App Review command failed. Check the explicit mode, target guards, confirmation, password input, and reserved identity ownership. No credentials are printed.\n");
  process.exitCode = 1;
}
