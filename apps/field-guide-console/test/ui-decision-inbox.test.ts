import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("decision inbox client behavior", () => {
  it("groups repository-local task IDs by project identity", async () => {
    const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
    expect(source).toContain("JSON.stringify([record.scope,record.projectKey||'',record.taskId])");
    expect(source).toContain("data-task-key");
    expect(source).not.toContain("const key=item.record.taskId");
  });

  it("keeps promotion identity stable across retries and waits for detail", async () => {
    const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
    expect(source).toContain("promotionAttempts:{}");
    expect(source).toContain("state.promotionAttempts[item.record.decisionRecordId]||");
    expect(source).toContain("idempotencyKey:attempt.candidateId");
    expect(source).toContain("candidateId:attempt.candidateId");
    expect(source).toContain("Wait for the full decision record before creating a candidate.");
    expect(source).toContain("Loading lesson draft…");
  });

  it("refreshes authoritative state after feedback conflicts", async () => {
    const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
    const feedback = source.slice(source.indexOf("async function submitDecisionFeedback"), source.indexOf("async function submitDecisionPromotion"));
    expect(feedback).toContain("if(error.status===409)");
    expect(feedback).toContain("state.decisionDetail=null;await loadReviews(false)");
    expect(feedback).toContain("review the latest feedback before retrying");
  });
});
