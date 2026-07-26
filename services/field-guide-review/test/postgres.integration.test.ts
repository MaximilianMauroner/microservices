import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { expect, it } from "vitest";
import { PostgresReviewRepository } from "../src/postgres-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseConfirmed =
  process.env.FIELD_GUIDE_TEST_DATABASE_CONFIRM === "field-guide-review-test";

it.skipIf(!databaseUrl || !databaseConfirmed)(
  "adopts shipped 001 once, migrates existing data, and supports amendments",
  async () => {
    const url = databaseUrl!;
    const candidateId = crypto.randomUUID();
    const decisionId = crypto.randomUUID();
    const createdAt = new Date("2026-07-26T00:00:00Z");
    const candidate = {
      candidateId,
      scope: "project" as const,
      projectKey: "integration",
      projectDisplayName: "Integration project",
      lessonKey: "adopt-existing",
      title: "Adopt existing decisions",
      body: "Keep existing audit events.",
      rationale: "Migration safety",
      evidence: [{ excerpt: "Existing production data", commitHashes: ["abc123"] }],
      createdAt: createdAt.toISOString(),
    };
    let repository = new PostgresReviewRepository(url);
    const bootstrap = postgres(url, { max: 1 });
    try {
      await bootstrap.unsafe("SET search_path TO public, pg_catalog");
      await bootstrap.unsafe(
        "DROP TABLE IF EXISTS public.field_guide_schema_migrations,public.application_receipts,public.verdict_events,public.review_rounds,public.candidates CASCADE",
      );
      const initial = await readFile(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      );
      await bootstrap.unsafe(initial);
      await bootstrap`INSERT INTO candidates(candidate_id,idempotency_key,payload,payload_hash,created_at) VALUES(${candidateId},${`existing-${candidateId}`},${bootstrap.json(candidate)},${"existing-hash"},${createdAt})`;
      await bootstrap`INSERT INTO review_rounds(candidate_id,round,kind) VALUES(${candidateId},1,'initial')`;
      await bootstrap`INSERT INTO verdict_events(decision_id,candidate_id,round,action,reviewer,reviewed_at,next_review_at) VALUES(${decisionId},${candidateId},1,'approve','owner@example.com',${createdAt},${new Date("2026-08-02T00:00:00Z")})`;
      await bootstrap`UPDATE review_rounds SET verdict_id=${decisionId} WHERE candidate_id=${candidateId} AND round=1`;
      await bootstrap`INSERT INTO review_rounds(candidate_id,round,kind,due_at) VALUES(${candidateId},2,'scheduled',${new Date("2026-08-02T00:00:00Z")})`;

      await repository.migrate();
      const firstLedger = await bootstrap<
        { name: string; checksum: string; adopted: boolean; applied_at: Date }[]
      >`SELECT name,checksum,adopted,applied_at FROM public.field_guide_schema_migrations ORDER BY name`;
      expect(firstLedger).toMatchObject([
        { name: "001_initial.sql", adopted: true },
        { name: "002_decision_amendments.sql", adopted: false },
      ]);
      const originalHistory = await repository.history(undefined, 10, "project");
      expect(originalHistory.decisions[0]).toMatchObject({
        decisionId,
        roundKind: "initial",
        effect: "activate",
        isCurrent: true,
        projectKey: "integration",
      });

      const amendment = await repository.amendDecision(
        candidateId,
        1,
        { expectedDecisionId: decisionId, action: "reject" },
        new Date("2026-07-27T00:00:00Z"),
        "owner@example.com",
      );
      expect(amendment).toMatchObject({
        effect: "deactivate",
        amendsDecisionId: decisionId,
      });
      expect(await repository.queue(undefined, new Date("2026-08-03T00:00:00Z"))).toHaveLength(0);
      const history = await repository.history(undefined, 10, "project");
      expect(history.decisions.map((decision) => decision.decisionId)).toEqual([
        amendment.decisionId,
        decisionId,
      ]);
      const agentFeed = await repository.decisions(undefined, 10);
      expect(agentFeed.decisions.map((decision) => decision.decisionId)).toEqual([
        decisionId,
        amendment.decisionId,
      ]);

      await repository.migrate();
      const secondLedger = await bootstrap<
        { name: string; checksum: string; adopted: boolean; applied_at: Date }[]
      >`SELECT name,checksum,adopted,applied_at FROM public.field_guide_schema_migrations ORDER BY name`;
      expect(
        secondLedger.map((row) => ({
          ...row,
          applied_at: row.applied_at.toISOString(),
        })),
      ).toEqual(
        firstLedger.map((row) => ({
          ...row,
          applied_at: row.applied_at.toISOString(),
        })),
      );
    } finally {
      await repository.close().catch(() => undefined);
      await bootstrap`
        DELETE FROM application_receipts
        WHERE decision_id IN (SELECT decision_id FROM verdict_events WHERE candidate_id=${candidateId})
      `.catch(() => undefined);
      await bootstrap`UPDATE review_rounds SET verdict_id=NULL WHERE candidate_id=${candidateId}`.catch(() => undefined);
      await bootstrap`DELETE FROM verdict_events WHERE candidate_id=${candidateId}`.catch(() => undefined);
      await bootstrap`DELETE FROM review_rounds WHERE candidate_id=${candidateId}`.catch(() => undefined);
      await bootstrap`DELETE FROM candidates WHERE candidate_id=${candidateId}`.catch(() => undefined);
      await bootstrap.end();
    }
  },
  30_000,
);
