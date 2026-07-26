import { describe, expect, it } from "vitest";
import { reviewConsole } from "../src/ui.js";

async function renderReviewConsole(): Promise<string> {
  return reviewConsole().text();
}

describe("review console feedback", () => {
  it("uses explicit element references and validates defer dates before saving", async () => {
    const html = await renderReviewConsole();

    expect(html).toContain('id="toast"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("const elements={");
    expect(html).toContain("elements.authMessage.textContent=message");
    expect(html).not.toContain("status.classList");
    expect(html).not.toContain("signin.onclick");
    expect(html).not.toContain("signout.onclick");
    expect(html).toContain("if(!identity.userId||!identity.token)");
    expect(html).toContain("Choose a future date before deferring.");
    expect(html.indexOf("if(!input.value")).toBeLessThan(html.indexOf("submitVerdict(card,'defer'"));
    expect(html).toContain("setCardBusy(card,false)");
    expect(html).toContain("Review saved.");
    expect(html).toContain("Authentication failed.");
  });

  it("escapes session and commit provenance in history", async () => {
    const html = await renderReviewConsole();

    expect(html).toContain("escapeHtml(item.sessionRef)");
    expect(html).toContain("item.commitHashes.map");
    expect(html).toContain("escapeHtml(hash)");
  });

  it("offers verdict-only amendments for current history decisions", async () => {
    const html = await renderReviewConsole();

    expect(html).toContain("Update decision");
    expect(html).toContain("if(!decision.canAmend)return ''");
    expect(html).toContain("decision.isCurrent?'Current decision':'Superseded'");
    expect(html).toContain("action!==decision.action||action==='defer'");
    expect(html).toContain("expectedDecisionId:row.dataset.decisionId");
    expect(html).toContain("/amendments");
    expect(html).toContain("The original remains in history.");
    expect(html).toContain("This decision changed elsewhere. History was refreshed");
    expect(html).not.toContain("data-edit-title");
    expect(html).not.toContain("data-delete-decision");
  });
});
