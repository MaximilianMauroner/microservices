import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("decision inbox client behavior", () => {
  it("keeps repository-local task IDs paired with project identity", async () => {
    const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
    expect(source).toContain("data-dashboard-project");
    expect(source).toContain("escapeHtml(decisionProject(record))");
    expect(source).toContain("escapeHtml(record.taskId)");
    expect(source).not.toContain("const key=item.record.taskId");
  });

  it("keeps promotion identity stable across retries and waits for detail", async () => {
    const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
    expect(source).toContain("promotionAttempts:{}");
    expect(source).toContain("state.promotionAttempts[item.record.decisionRecordId]||");
    expect(source).toContain("idempotencyKey:attempt.candidateId");
    expect(source).toContain("candidateId:attempt.candidateId");
    expect(source).toContain("Wait for the full decision record before creating a candidate.");
    expect(source).toContain("data-show-promotion'+(detailReady?'':disabled)");
  });

  it("uses source-project provenance for dashboard groups", async () => {
    const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
    expect(source).toContain("record.foundProjectDisplayName||record.foundProjectKey||record.projectDisplayName||record.projectKey||'Global'");
    expect(source).toContain("const key=decisionProjectKey(item.record)");
  });

  it("refreshes authoritative state after feedback conflicts", async () => {
    const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
    const feedback = source.slice(source.indexOf("async function submitDecisionFeedback"), source.indexOf("async function submitDecisionPromotion"));
    expect(feedback).toContain("if(error.status===409)");
    expect(feedback).toContain("state.decisionDetail=null;await loadReviews(false)");
    expect(feedback).toContain("review the latest feedback before retrying");
  });

  it("advances to the adjacent record after session feedback", async () => {
    const source = await readFile(new URL("../src/ui.ts", import.meta.url), "utf8");
    const feedback = source.slice(source.indexOf("async function submitDecisionFeedback"), source.indexOf("async function submitDecisionPromotion"));
    expect(feedback).toContain("nextRecordId=state.decisionItems[currentIndex+1]");
    expect(feedback).toContain("state.selectedRecord=nextRecordId");
  });
});
