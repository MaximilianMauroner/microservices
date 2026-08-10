import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  applicationReceipts,
  candidates,
  decisionFeedbackEvents,
  decisionPromotionRecords,
  decisionPromotions,
  decisionRecords,
  fieldGuideSchemaMigrations,
  reviewRounds,
  verdictEvents,
} from "../src/db/postgres-schema.js";

const dialect = new PgDialect();
const tables = [
  candidates,
  reviewRounds,
  verdictEvents,
  applicationReceipts,
  fieldGuideSchemaMigrations,
  decisionRecords,
  decisionFeedbackEvents,
  decisionPromotions,
  decisionPromotionRecords,
];

function foreignKeys(table: (typeof tables)[number]) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      name: foreignKey.getName(),
      columns: reference.columns.map((column) => column.name),
      foreignTable: getTableConfig(reference.foreignTable).name,
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
      onUpdate: foreignKey.onUpdate,
    };
  });
}

describe("Postgres schema contract", () => {
  it("owns the Field Guide tables in the shared Drizzle push", async () => {
    expect(tables.map((table) => getTableConfig(table).name)).toEqual([
      "candidates",
      "review_rounds",
      "verdict_events",
      "application_receipts",
      "field_guide_schema_migrations",
      "decision_records",
      "decision_feedback_events",
      "decision_promotions",
      "decision_promotion_records",
    ]);

    const config = await readFile(new URL("../drizzle.postgres.config.ts", import.meta.url), "utf8");
    expect(config).toContain('dialect: "postgresql"');
    expect(config).toContain('schema: "./src/db/postgres-schema.ts"');
    expect(config).toContain('schemaFilter: ["field_guide"]');
    expect(config).toContain('tablesFilter: [');
    expect(config).toContain("consumePushHandoff(process.env)");
    expect(config).not.toContain("PUSH_AUTHORIZATION");
  });

  it("scopes runtime pushes to one schema each", async () => {
    const [tools, artifacts] = await Promise.all([
      readFile(new URL("../drizzle.tools.config.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle.artifacts.config.ts", import.meta.url), "utf8"),
    ]);
    expect(tools).toContain('schemaFilter: ["tools"]');
    expect(tools).not.toContain('"objects"');
    expect(artifacts).toContain('schemaFilter: ["artifacts"]');
    expect(artifacts).toContain('tablesFilter: ["objects", "operations"]');
  });

  it("exports runtime schemas for Drizzle ownership", async () => {
    const schema = await readFile(new URL("../../database/postgres-schema.ts", import.meta.url), "utf8");
    expect(schema).toContain('export const toolsSchema = pgSchema("tools")');
    expect(schema).toContain('export const artifactsSchema = pgSchema("artifacts")');
  });

  it("never bypasses Drizzle decisions with hints", async () => {
    const push = await readFile(new URL("../src/push-postgres.ts", import.meta.url), "utf8");
    expect(push).not.toContain("--hints");
  });

  it("reconciles check expression changes after successful schema pushes", async () => {
    const push = await readFile(new URL("../src/push-postgres.ts", import.meta.url), "utf8");
    expect(push).toContain("reconcileRuntimeSchema");
  });

  it("keeps the runtime search path aligned with the pushed Field Guide tables", async () => {
    const repository = await readFile(
      new URL("../src/postgres-repository.ts", import.meta.url),
      "utf8",
    );
    expect(repository).toContain('const FIELD_GUIDE_SCHEMA = "field_guide"');
  });

  it("filters decision records by effective source-project provenance", async () => {
    const [postgresStore, memoryStore] = await Promise.all([
      readFile(new URL("../src/postgres-decision-records.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/memory-repository.ts", import.meta.url), "utf8"),
    ]);
    expect(postgresStore).toContain("COALESCE(d.payload->>'foundProjectKey',d.payload->>'projectKey')");
    expect(memoryStore).toContain("(record.foundProjectKey ?? record.projectKey) === filters.projectKey");
  });

  it("canonicalizes decision UUIDs at every repository boundary", async () => {
    const [postgresStore, memoryStore] = await Promise.all([
      readFile(new URL("../src/postgres-decision-records.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/memory-repository.ts", import.meta.url), "utf8"),
    ]);
    for (const source of [postgresStore, memoryStore]) {
      expect(source).toContain('canonicalUuid(record.decisionRecordId, "decisionRecordId")');
      expect(source).toContain('canonicalUuid(id, "decisionRecordId")');
      expect(source).toContain('canonicalUuid(candidate.candidateId, "candidateId")');
    }
  });

  it("matches the production columns, keys, checks, and bigserial", () => {
    const candidateConfig = getTableConfig(candidates);
    expect(candidateConfig.columns.map((column) => [
      column.name,
      column.getSQLType(),
      column.notNull,
    ])).toEqual([
      ["candidate_id", "uuid", true],
      ["idempotency_key", "text", true],
      ["payload", "jsonb", true],
      ["payload_hash", "text", true],
      ["created_at", "timestamp with time zone", true],
    ]);
    expect(candidates.candidateId.primary).toBe(true);
    expect(candidates.idempotencyKey.uniqueName).toBe(
      "candidates_idempotency_key_key",
    );

    const roundConfig = getTableConfig(reviewRounds);
    expect(roundConfig.columns.map((column) => [column.name, column.notNull])).toEqual([
      ["candidate_id", true],
      ["round", true],
      ["kind", true],
      ["due_at", false],
      ["verdict_id", false],
    ]);
    expect(roundConfig.primaryKeys.map((key) => key.getName())).toEqual([
      "review_rounds_pkey",
    ]);
    expect(reviewRounds.verdictId.uniqueName).toBe(
      "review_rounds_verdict_id_key",
    );
    expect(roundConfig.checks.map((constraint) => constraint.name)).toEqual([
      "review_rounds_kind_check",
    ]);

    const verdictConfig = getTableConfig(verdictEvents);
    expect(verdictEvents.sequence.getSQLType()).toBe("bigserial");
    expect(verdictEvents.sequence.primary).toBe(true);
    expect(verdictEvents.decisionId.uniqueName).toBe(
      "verdict_events_decision_id_key",
    );
    expect(verdictConfig.columns.map((column) => [column.name, column.notNull])).toEqual([
      ["sequence", true],
      ["decision_id", true],
      ["candidate_id", true],
      ["round", true],
      ["action", true],
      ["reviewer", true],
      ["reviewed_at", true],
      ["next_review_at", false],
      ["round_kind", true],
      ["effect", true],
      ["amends_decision_id", false],
    ]);
    expect(verdictConfig.checks.map((constraint) => constraint.name)).toEqual([
      "verdict_events_round_kind_check",
      "verdict_events_effect_check",
    ]);

    const receiptConfig = getTableConfig(applicationReceipts);
    expect(applicationReceipts.idempotencyKey.primary).toBe(true);
    expect(receiptConfig.checks.map((constraint) => constraint.name)).toEqual([
      "application_receipts_result_check",
    ]);
  });

  it("preserves both circular references and all foreign-key actions", () => {
    expect(foreignKeys(reviewRounds)).toEqual([
      {
        name: "review_rounds_candidate_id_fkey",
        columns: ["candidate_id"],
        foreignTable: "candidates",
        foreignColumns: ["candidate_id"],
        onDelete: "no action",
        onUpdate: "no action",
      },
      {
        name: "review_rounds_verdict_id_fkey",
        columns: ["verdict_id"],
        foreignTable: "verdict_events",
        foreignColumns: ["decision_id"],
        onDelete: "no action",
        onUpdate: "no action",
      },
    ]);
    expect(foreignKeys(verdictEvents)).toEqual([
      {
        name: "verdict_events_candidate_id_round_fkey",
        columns: ["candidate_id", "round"],
        foreignTable: "review_rounds",
        foreignColumns: ["candidate_id", "round"],
        onDelete: "no action",
        onUpdate: "no action",
      },
      {
        name: "verdict_events_amends_decision_id_fkey",
        columns: ["amends_decision_id"],
        foreignTable: "verdict_events",
        foreignColumns: ["decision_id"],
        onDelete: "no action",
        onUpdate: "no action",
      },
    ]);
    expect(foreignKeys(applicationReceipts)).toEqual([
      {
        name: "application_receipts_decision_id_fkey",
        columns: ["decision_id"],
        foreignTable: "verdict_events",
        foreignColumns: ["decision_id"],
        onDelete: "no action",
        onUpdate: "no action",
      },
    ]);
  });

  it("allows only one amendment per parent with the named partial index", () => {
    const indexes = getTableConfig(verdictEvents).indexes;
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.config.name).toBe(
      "verdict_events_one_amendment_per_parent",
    );
    expect(indexes[0]?.config.unique).toBe(true);
    expect(indexes[0]?.config.columns).toHaveLength(1);
    expect(indexes[0]?.config.columns[0]).toMatchObject({
      name: "amends_decision_id",
    });
    expect(
      dialect.sqlToQuery(indexes[0]?.config.where ?? sql`false`).sql,
    ).toBe('"field_guide"."verdict_events"."amends_decision_id" is not null');
  });

  it("keeps verdict events append-only and schema changes out of startup", async () => {
    const repository = await readFile(
      new URL("../src/postgres-repository.ts", import.meta.url),
      "utf8",
    );
    const types = await readFile(new URL("../src/types.ts", import.meta.url), "utf8");
    expect(repository).not.toMatch(/UPDATE verdict_events|DELETE FROM verdict_events/);
    expect(repository.match(/ON CONFLICT DO NOTHING/g)).toHaveLength(2);
    expect(repository).toContain("authoritativeConfirmations");
    expect(repository).not.toContain("pg_advisory_xact_lock");
    expect(repository).not.toContain("readFile");
    expect(repository).not.toMatch(/\bmigrate\b/);
    expect(types).not.toContain("migrate():");
  });

  it("uses an explicit guarded PostgreSQL push", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.scripts["db:push-sqlite"]).toBeUndefined();
    expect(packageJson.scripts["db:push-postgres"]).toBe("tsx src/push-postgres.ts production");
    expect(packageJson.scripts["db:generate"]).toBeUndefined();
    expect(Object.values(packageJson.scripts).join(" ")).not.toContain("--force");
    expect(packageJson.dependencies["drizzle-orm"]).toBe("1.0.0-rc.4");
    expect(packageJson.devDependencies["drizzle-kit"]).toBe("1.0.0-rc.4");
  });
});
