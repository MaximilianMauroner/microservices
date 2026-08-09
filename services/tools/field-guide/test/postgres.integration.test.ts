import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres, { type Sql } from "postgres";
import { expect, it } from "vitest";
import { PostgresReviewRepository } from "../src/postgres-repository.js";
import { encodeCursor } from "../src/types.js";
import {
  DISPOSABLE_DATABASE_SENTINEL,
  withVerifiedDisposableDatabase,
} from "./postgres-test-gate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseConfirmed =
  process.env.FIELD_GUIDE_TEST_DATABASE_CONFIRM === "field-guide-console-test";
const execFileAsync = promisify(execFile);
const serviceDirectory = fileURLToPath(new URL("..", import.meta.url));

async function pushSchema(url: string) {
  await execFileAsync("pnpm", ["run", "db:push-postgres:test"], {
    cwd: serviceDirectory,
    env: { ...process.env, TEST_DATABASE_URL: url, FIELD_GUIDE_TEST_DATABASE_CONFIRM: "field-guide-console-test" },
  });
}

async function pushVerifiedSchema(
  database: Sql,
  url: string,
  onVerified?: () => void,
) {
  await withVerifiedDisposableDatabase(
    {
      readRelationKind: async () => {
        const rows = await database<{ relation_kind: string }[]>`
          SELECT relation.relkind::text relation_kind
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
          WHERE namespace.nspname='public'
            AND relation.relname=${DISPOSABLE_DATABASE_SENTINEL.relation}
        `;
        return rows[0]?.relation_kind;
      },
      readValue: async () => {
        const rows = await database<{ sentinel_value: string }[]>`
          SELECT sentinel_value
          FROM public.field_guide_review_test_sentinel
          WHERE sentinel_key=${DISPOSABLE_DATABASE_SENTINEL.key}
        `;
        return rows[0]?.sentinel_value;
      },
    },
    async () => {
      onVerified?.();
      await pushSchema(url);
    },
  );
}

it.skipIf(!databaseUrl || !databaseConfirmed)(
  "direct-pushes the owned schema without losing decisions or amendments",
  async () => {
    const url = databaseUrl!;
    const candidateId = crypto.randomUUID();
    const receiptKey = `direct-push-receipt-${crypto.randomUUID()}`;
    const createdAt = new Date("2026-07-26T00:00:00Z");
    const candidate = {
      candidateId,
      scope: "project" as const,
      projectKey: "integration",
      projectDisplayName: "Integration project",
      lessonKey: "preserve-existing",
      title: "Preserve existing decisions",
      body: "Keep the append-only audit history during schema pushes.",
      rationale: "Direct-push safety",
      evidence: [{ excerpt: "Existing test data", commitHashes: ["abc123"] }],
      createdAt: createdAt.toISOString(),
    };
    const database = postgres(url, { max: 1 });
    let repository: PostgresReviewRepository | undefined;
    let sentinelAccepted = false;
    try {
      await pushVerifiedSchema(database, url, () => {
        sentinelAccepted = true;
      });
      repository = new PostgresReviewRepository(url);
      await repository.createCandidate(`direct-push-${candidateId}`, candidate);
      const original = await repository.decide(
        candidateId,
        1,
        { action: "approve" },
        createdAt,
        "owner@example.com",
      );
      const existingAmendment = await repository.amendDecision(
        candidateId,
        1,
        { expectedDecisionId: original.decisionId, action: "reject" },
        new Date("2026-07-27T00:00:00Z"),
        "owner@example.com",
      );
      await repository.createReceipt(
        receiptKey,
        existingAmendment.decisionId,
        "2026-07-27T00:05:00.000Z",
        "applied",
      );
      const beforeEvents = await database<
        { sequence: string; decision_id: string; amends_decision_id: string | null }[]
      >`SELECT sequence::text sequence,decision_id,amends_decision_id
        FROM verdict_events
        WHERE candidate_id=${candidateId}
        ORDER BY sequence`;
      if (!beforeEvents[0]) throw new Error("Original decision was not stored.");
      const beforePointer = await database<
        { verdict_id: string | null }[]
      >`SELECT verdict_id FROM review_rounds
        WHERE candidate_id=${candidateId} AND round=1`;
      const beforeReceipt = await database<
        {
          idempotency_key: string;
          payload_hash: string;
          decision_id: string;
          applied_at: Date;
          result: string;
        }[]
      >`SELECT idempotency_key,payload_hash,decision_id,applied_at,result
        FROM application_receipts
        WHERE idempotency_key=${receiptKey}`;

      sentinelAccepted = false;
      await pushVerifiedSchema(database, url, () => {
        sentinelAccepted = true;
      });
      const afterEvents = await database<
        { sequence: string; decision_id: string; amends_decision_id: string | null }[]
      >`SELECT sequence::text sequence,decision_id,amends_decision_id
        FROM verdict_events
        WHERE candidate_id=${candidateId}
        ORDER BY sequence`;
      const afterPointer = await database<
        { verdict_id: string | null }[]
      >`SELECT verdict_id FROM review_rounds
        WHERE candidate_id=${candidateId} AND round=1`;
      const afterReceipt = await database<
        {
          idempotency_key: string;
          payload_hash: string;
          decision_id: string;
          applied_at: Date;
          result: string;
        }[]
      >`SELECT idempotency_key,payload_hash,decision_id,applied_at,result
        FROM application_receipts
        WHERE idempotency_key=${receiptKey}`;
      expect(afterEvents).toEqual(beforeEvents);
      expect(afterEvents).toEqual([
        {
          sequence: beforeEvents[0]?.sequence,
          decision_id: original.decisionId,
          amends_decision_id: null,
        },
        {
          sequence: beforeEvents[1]?.sequence,
          decision_id: existingAmendment.decisionId,
          amends_decision_id: original.decisionId,
        },
      ]);
      expect(afterPointer).toEqual(beforePointer);
      expect(afterPointer).toEqual([
        { verdict_id: existingAmendment.decisionId },
      ]);
      expect(afterReceipt).toEqual(beforeReceipt);
      expect(afterReceipt).toHaveLength(1);
      expect(afterReceipt[0]).toMatchObject({
        idempotency_key: receiptKey,
        decision_id: existingAmendment.decisionId,
        result: "applied",
      });

      const newAmendment = await repository.amendDecision(
        candidateId,
        1,
        { expectedDecisionId: existingAmendment.decisionId, action: "approve" },
        new Date("2026-07-28T00:00:00Z"),
        "owner@example.com",
      );
      expect(newAmendment).toMatchObject({
        effect: "activate",
        amendsDecisionId: existingAmendment.decisionId,
      });
      const history = await repository.history(undefined, 10_000, "project");
      expect(history.decisions
        .filter((decision) => decision.candidateId === candidateId)
        .map((decision) => decision.decisionId)).toEqual([
        newAmendment.decisionId,
        existingAmendment.decisionId,
        original.decisionId,
      ]);
      const feed = await repository.decisions(
        encodeCursor((BigInt(beforeEvents[0].sequence) - 1n).toString()),
        10,
        "project",
      );
      expect(feed.decisions
        .filter((decision) => decision.candidateId === candidateId)
        .map((decision) => decision.decisionId)).toEqual([
        original.decisionId,
        existingAmendment.decisionId,
        newAmendment.decisionId,
      ]);
    } finally {
      await repository?.close().catch(() => undefined);
      if (sentinelAccepted) {
        await database`
          DELETE FROM application_receipts
          WHERE decision_id IN (
            SELECT decision_id FROM verdict_events WHERE candidate_id=${candidateId}
          )
        `.catch(() => undefined);
        await database`UPDATE review_rounds SET verdict_id=NULL WHERE candidate_id=${candidateId}`.catch(() => undefined);
        await database`DELETE FROM verdict_events WHERE candidate_id=${candidateId}`.catch(() => undefined);
        await database`DELETE FROM review_rounds WHERE candidate_id=${candidateId}`.catch(() => undefined);
        await database`DELETE FROM candidates WHERE candidate_id=${candidateId}`.catch(() => undefined);
      }
      await database.end();
    }
  },
  30_000,
);
