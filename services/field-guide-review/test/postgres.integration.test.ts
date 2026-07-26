import crypto from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { PostgresReviewRepository } from "../src/postgres-repository.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseConfirmed=process.env.FIELD_GUIDE_TEST_DATABASE_CONFIRM==="field-guide-review-test";
it.skipIf(!databaseUrl||!databaseConfirmed)(
  "persists the complete immutable review flow across reconnects",
  async () => {
    const url = databaseUrl!;
    const candidateId = crypto.randomUUID(),
      key = `test-${crypto.randomUUID()}`,
      candidate = {
        candidateId,
        scope: "project" as const,
        projectKey: "integration",
        projectDisplayName: "Integration project",
        lessonKey: "restart",
        title: "Survives restart",
        body: "Body",
        rationale: "Rationale",
        evidence: [
          {
            excerpt: "Evidence",
            sessionRef: "session-1",
            commitHashes: ["abc123"],
          },
        ],
        createdAt: new Date().toISOString(),
      };
    const appliedAt=new Date().toISOString();
    let decisionId="";
    let repository = new PostgresReviewRepository(url);
    try {
      await repository.migrate();
      expect(await repository.createCandidate(key, candidate)).toBe("created");
      expect(await repository.createCandidate(key, candidate)).toBe("replay");
      const decision = await repository.decide(
        candidateId,
        1,
        { action: "approve" },
        new Date(),
        "owner@example.com",
      );
      decisionId=decision.decisionId;
      expect(
        await repository.createReceipt(
          `${key}-receipt`,
          decision.decisionId,
          appliedAt,
          "applied",
        ),
      ).toBe("created");
      await repository.close();
      repository = new PostgresReviewRepository(url);
      await repository.migrate();
      const history = await repository.history(undefined, 10, "project");
      expect(
        history.decisions.find((d) => d.candidateId === candidateId),
      ).toMatchObject({
        projectKey: "integration",
        projectDisplayName: "Integration project",
        reviewer: "owner@example.com",
        evidence: candidate.evidence,
      });
      expect(await repository.createCandidate(key, candidate)).toBe("replay");
      expect(await repository.createReceipt(`${key}-receipt`,decisionId,appliedAt,"applied")).toBe("replay");
    } finally {
      await repository.close().catch(() => undefined);
      const sql = postgres(url, { max: 1 });
      try {
        await sql`DELETE FROM application_receipts WHERE idempotency_key=${`${key}-receipt`}`;
        await sql`DELETE FROM verdict_events WHERE candidate_id=${candidateId}`;
        await sql`DELETE FROM review_rounds WHERE candidate_id=${candidateId}`;
        await sql`DELETE FROM candidates WHERE candidate_id=${candidateId}`;
      } finally {
        await sql.end();
      }
    }
  },
  30_000,
);
