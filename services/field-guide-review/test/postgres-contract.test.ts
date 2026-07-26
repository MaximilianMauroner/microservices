import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  applicationReceipts,
  candidates,
  reviewRounds,
  verdictEvents,
} from "../src/db/schema.js";

const dialect = new PgDialect();
const tables = [
  candidates,
  reviewRounds,
  verdictEvents,
  applicationReceipts,
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
  it("owns exactly the four filtered public tables", async () => {
    expect(tables.map((table) => getTableConfig(table).name)).toEqual([
      "candidates",
      "review_rounds",
      "verdict_events",
      "application_receipts",
    ]);

    const config = await readFile(
      new URL("../drizzle.config.ts", import.meta.url),
      "utf8",
    );
    expect(config).toContain('dialect: "postgresql"');
    expect(config).toContain('schema: "./src/db/schema.ts"');
    expect(config).toContain('schemaFilter: ["public"]');
    expect(config).toContain(
      'tablesFilter: [\n    "candidates",\n    "review_rounds",\n    "verdict_events",\n    "application_receipts",\n  ]',
    );
    expect(config).toContain("DATABASE_URL must be a non-empty PostgreSQL URL.");
    expect(config).toContain('["postgres:", "postgresql:"]');
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
    ).toBe('"verdict_events"."amends_decision_id" is not null');
  });

  it("keeps verdict events append-only and removes runtime schema management", async () => {
    const repository = await readFile(
      new URL("../src/postgres-repository.ts", import.meta.url),
      "utf8",
    );
    const types = await readFile(new URL("../src/types.ts", import.meta.url), "utf8");
    const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
    expect(repository).not.toMatch(/UPDATE verdict_events|DELETE FROM verdict_events/);
    expect(repository.match(/ON CONFLICT DO NOTHING/g)).toHaveLength(2);
    expect(repository).toContain("authoritativeConfirmations");
    expect(repository).not.toContain("pg_advisory_xact_lock");
    expect(repository).not.toContain("readFile");
    expect(repository).not.toMatch(/\bmigrate\b/);
    expect(types).not.toContain("migrate():");
    expect(server).not.toContain("repository.migrate");

    const productionSources = (
      await Promise.all(
        [
          "../README.md",
          "../drizzle.config.ts",
          "../package.json",
          "../railway.json",
          "../src/db/schema.ts",
          "../src/memory-repository.ts",
          "../src/postgres-repository.ts",
          "../src/server.ts",
          "../src/types.ts",
        ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
      )
    ).join("\n");
    expect(productionSources).not.toMatch(
      /field_guide_schema_migrations|00[12]_[a-z_]+\.sql|pg_advisory_xact_lock|migrations\//,
    );
    expect(productionSources).not.toMatch(/\bmigrate\s*\(/);
  });

  it("runs direct push as Railway's blocking predeploy step", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    const railway = JSON.parse(
      await readFile(new URL("../railway.json", import.meta.url), "utf8"),
    ) as {
      deploy: {
        preDeployCommand: string[];
        startCommand: string;
        healthcheckPath: string;
        restartPolicyType: string;
      };
    };
    expect(packageJson.scripts["db:plan"]).toBe(
      "drizzle-kit push --explain --verbose",
    );
    expect(packageJson.scripts["db:push"]).toBe("drizzle-kit push");
    expect(Object.values(packageJson.scripts).join(" ")).not.toContain("--force");
    expect(railway.deploy).toMatchObject({
      preDeployCommand: ["bun run db:push"],
      startCommand: "bun run start",
      healthcheckPath: "/health",
      restartPolicyType: "ON_FAILURE",
    });
  });
});
