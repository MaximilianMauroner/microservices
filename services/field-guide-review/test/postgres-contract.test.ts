import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function sources() {
  const initial = await readFile(
    new URL("../migrations/001_initial.sql", import.meta.url),
    "utf8",
  );
  const amendments = await readFile(
    new URL("../migrations/002_decision_amendments.sql", import.meta.url),
    "utf8",
  );
  const repository = await readFile(
    new URL("../src/postgres-repository.ts", import.meta.url),
    "utf8",
  );
  return { initial, amendments, repository };
}

describe("Postgres repository contract", () => {
  it("keeps verdict events append-only and projects amendment authority", async () => {
    const { initial, amendments, repository } = await sources();
    expect(initial).toContain("candidate_id uuid PRIMARY KEY");
    expect(initial).toContain("reviewer text NOT NULL");
    expect(amendments).toContain(
      "DROP CONSTRAINT IF EXISTS verdict_events_candidate_id_round_key",
    );
    expect(amendments).toContain("verdict_events_one_amendment_per_parent");
    expect(amendments).toContain("FOREIGN KEY (amends_decision_id)");
    expect(amendments).toContain("ALTER COLUMN effect SET NOT NULL");
    expect(repository.match(/ON CONFLICT DO NOTHING/g)).toHaveLength(2);
    expect(repository).toContain("payload_hash===hash");
    expect(repository).toContain("authoritativeConfirmations");
    expect(repository).toContain("FOR UPDATE OF c,r");
    expect(repository).toContain("schedule.nextReviewAt?.getTime()===row.next_review_at?.getTime()");
    expect(repository).toContain("Choose a different defer date.");
    expect(repository).not.toMatch(/UPDATE verdict_events|DELETE FROM verdict_events/);
  });

  it("coordinates and records each migration exactly once", async () => {
    const { initial, amendments, repository } = await sources();
    expect(repository).toContain("pg_advisory_xact_lock");
    expect(repository).toContain('const FIELD_GUIDE_SCHEMA = "public"');
    expect(repository).toContain("connection: { search_path: FIELD_GUIDE_SCHEMA }");
    expect(repository).toContain("to_regnamespace(${FIELD_GUIDE_SCHEMA})");
    expect(repository).toContain("SET LOCAL search_path TO ${FIELD_GUIDE_SCHEMA}, pg_catalog");
    expect(repository).toContain("if (!ledger[0]?.ledger)");
    expect(repository).toContain("CREATE TABLE public.field_guide_schema_migrations");
    expect(repository).toContain("SELECT name,checksum FROM public.field_guide_schema_migrations");
    expect(repository).toContain("Applied migration ${migration.name} has a different checksum.");
    expect(repository).toContain("present !== 0 && present !== 4");
    expect(repository).toContain("format_type(attribute.atttypid,attribute.atttypmod)");
    expect(repository).toContain("BASELINE_COLUMNS");
    expect(repository).toContain("BASELINE_CONSTRAINTS");
    expect(repository).toContain("validateBaselineColumns(columns)");
    expect(repository).toContain("validateBaselineConstraints");
    expect(repository).toContain("pg_get_constraintdef");
    expect(repository).toContain("constraint.condeferrable deferrable");
    expect(repository).toContain("referenced_namespace.nspname referenced_schema");
    expect(repository).toContain("source.relname table_name");
    expect(repository).toContain("AND source.relname IN ('candidates','review_rounds','verdict_events','application_receipts')");
    expect(repository).toContain("`${constraint.tableName}.${constraint.name}`");
    expect(repository).toContain('constraint?.foreignDeleteAction==="a"');
    expect(repository).toContain('constraint.foreignMatchType==="s"');
    expect(repository).toContain("pg_get_expr(default_value.adbin,default_value.adrelid)");
    expect(repository).toContain("pg_get_serial_sequence('public.verdict_events','sequence')");
    expect(repository).toContain("validateSequenceDefault");
    expect(repository).toContain("Cannot adopt an incompatible field-guide schema.");
    expect(repository).toContain("adopted = present === 4");
    expect(repository).toContain("if (!adopted) await tx.unsafe(migration.sql)");
    expect(repository).toContain("INSERT INTO public.field_guide_schema_migrations(name,checksum,adopted)");
    expect(repository).toContain("containsTransactionControl(sql)");
    expect(initial).not.toMatch(/^\s*(BEGIN\s*;|COMMIT\b|ROLLBACK\b)/im);
    expect(amendments).not.toMatch(/^\s*(BEGIN\s*;|COMMIT\b|ROLLBACK\b)/im);
  });

  it("keeps reviewer history descending without changing the agent feed", async () => {
    const { repository } = await sources();
    expect(repository).toContain("v.sequence>${after} ORDER BY v.sequence ASC");
    expect(repository).toContain("v.sequence<${before??null}) ORDER BY v.sequence DESC");
  });
});
