import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { expect, it } from "vitest";
import { migratePostgres } from "../src/migrate-postgres.js";
import { PostgresReviewRepository } from "../src/postgres-repository.js";
import type { Candidate, DecisionRecord } from "../src/types.js";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "./postgres-test-gate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const confirmed = process.env.FIELD_GUIDE_TEST_DATABASE_CONFIRM === "field-guide-console-test";
const execFileAsync = promisify(execFile);
const serviceDirectory = fileURLToPath(new URL("..", import.meta.url));
const now = new Date("2026-08-02T12:00:00.000Z");

it.skipIf(!databaseUrl || !confirmed)("migrates the old PostgreSQL schema idempotently and supports decision workflows", async () => {
  const url = databaseUrl!;
  const database = postgres(url, { max: 2 });
  let authorized = false;
  let repository: PostgresReviewRepository | undefined;
  const ids: string[] = [];
  try {
    await withVerifiedDisposableDatabase({
      readRelationKind: async () => (await database<{ kind: string }[]>`
        SELECT c.relkind::text kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
      readValue: async () => (await database<{ value: string }[]>`
        SELECT sentinel_value value FROM field_guide_review_test_sentinel
        WHERE sentinel_key=${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
    }, async () => { authorized = true; });
    if (!authorized) throw new Error("Disposable database was not authorized.");
    await execFileAsync("bun", ["x", "drizzle-kit", "push", "--config", "drizzle.postgres.config.ts"], {
      cwd: serviceDirectory,
      env: { ...process.env, TEST_DATABASE_URL: url },
    });
    await database`DROP TABLE decision_promotion_records,decision_promotions,decision_feedback_events,decision_records`;
    await database`DELETE FROM field_guide_schema_migrations WHERE name='20260802120000_decision_records_postgres'`;

    await migratePostgres(database);
    await migratePostgres(database);
    expect((await database<{ count: number }[]>`SELECT COUNT(*)::int count FROM field_guide_schema_migrations WHERE name='20260802120000_decision_records_postgres'`)[0]?.count).toBe(1);
    expect((await database<{ name: string }[]>`SELECT indexname name FROM pg_indexes WHERE schemaname='public' AND indexname='decision_feedback_events_record_sequence_idx'`)[0]?.name).toBe("decision_feedback_events_record_sequence_idx");

    repository = new PostgresReviewRepository(url);
    const first = record();
    const second = record();
    ids.push(first.decisionRecordId, second.decisionRecordId);
    expect(await repository.createDecisionRecord("migration-first", first)).toBe("created");
    expect(await repository.createDecisionRecord("migration-first", first)).toBe("replay");
    await repository.createDecisionRecord("migration-second", second);
    const oldReview = new Date(now.getTime() - 45 * 86_400_000);
    const firstFeedback = await repository.addDecisionFeedback(first.decisionRecordId, { action: "up" }, oldReview, "max@example.com");
    await repository.addDecisionFeedback(first.decisionRecordId, { action: "down", expectedFeedbackId: firstFeedback.feedbackId }, oldReview, "max@example.com");
    await repository.addDecisionFeedback(second.decisionRecordId, { action: "up" }, now, "max@example.com");
    expect((await repository.decisionRecords({ limit: 10, reviewState: "reviewed", includeArchived: false, archiveAfterDays: 30, now })).items.map((item) => item.record.decisionRecordId)).toEqual([second.decisionRecordId]);
    expect((await repository.decisionRecord(first.decisionRecordId, now, 30)).archived).toBe(true);

    const firstCandidate = candidate();
    const concurrentCandidate = candidate();
    ids.push(firstCandidate.candidateId, concurrentCandidate.candidateId);
    const promoted = await repository.promoteDecisionRecords("migration-promotion", [first.decisionRecordId], firstCandidate, now, "max@example.com");
    expect(promoted.status).toBe("created");
    const concurrent = await Promise.all([
      repository.promoteDecisionRecords("concurrent-promotion", [second.decisionRecordId], concurrentCandidate, now, "max@example.com"),
      repository.promoteDecisionRecords("concurrent-promotion", [second.decisionRecordId], concurrentCandidate, now, "max@example.com"),
    ]);
    expect(concurrent.map((result) => result.status).sort()).toEqual(["created", "replay"]);
  } finally {
    await repository?.close().catch(() => undefined);
    if (authorized) {
      await database`DELETE FROM decision_promotion_records WHERE decision_record_id IN ${database(ids.slice(0, 2))}`.catch(() => undefined);
      await database`DELETE FROM decision_promotions WHERE candidate_id IN ${database(ids.slice(2))}`.catch(() => undefined);
      await database`DELETE FROM review_rounds WHERE candidate_id IN ${database(ids.slice(2))}`.catch(() => undefined);
      await database`DELETE FROM candidates WHERE candidate_id IN ${database(ids.slice(2))}`.catch(() => undefined);
      await database`DELETE FROM decision_feedback_events WHERE decision_record_id IN ${database(ids.slice(0, 2))}`.catch(() => undefined);
      await database`DELETE FROM decision_records WHERE decision_record_id IN ${database(ids.slice(0, 2))}`.catch(() => undefined);
    }
    await database.end();
  }
}, 60_000);

function record(): DecisionRecord {
  return {
    schemaVersion: 1,
    decisionRecordId: crypto.randomUUID(),
    taskId: "postgres-migration",
    scope: "project",
    projectKey: "microservices",
    projectDisplayName: "Microservices",
    summary: "Exercise migrated storage",
    context: "The production migration must create every access path.",
    options: [{ label: "Skip migration" }, { label: "Run migration" }],
    choice: "Run migration",
    rationale: "Schema must precede traffic.",
    consequences: [],
    confidence: "high",
    evidence: [],
    createdAt: now.toISOString(),
  };
}

function candidate(): Candidate {
  return {
    candidateId: crypto.randomUUID(),
    scope: "project",
    projectKey: "microservices",
    projectDisplayName: "Microservices",
    lessonKey: `migration-${crypto.randomUUID()}`,
    title: "Run schema migrations before traffic",
    body: "Apply committed migrations during pre-deploy.",
    rationale: "Readiness must see the new tables.",
    evidence: [],
    createdAt: now.toISOString(),
  };
}
