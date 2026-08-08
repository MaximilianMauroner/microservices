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
    expect(html).toContain("state.token='cloudflare-access'");
    expect(html).toContain("Choose a future date and time before deferring.");
    expect(html.indexOf("if(!date||date.getTime()<=Date.now())")).toBeLessThan(html.indexOf("submitVerdict(card,'defer'"));
    expect(html).toContain("setCardBusy(card,false)");
    expect(html).toContain("Review saved.");
    expect(html).toContain("/cdn-cgi/access/logout");
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

  it("offers origin-aware promotion and demotion before initial approval", async () => {
    const html = await renderReviewConsole();

    expect(html).toContain("Promote to global");
    expect(html).toContain("Demote to project");
    expect(html).toContain("No associated project. This candidate was found globally.");
    expect(html).toContain('disabled data-always-disabled aria-disabled="true" title="No associated project"');
    expect(html).toContain("disabled:cursor-not-allowed disabled:opacity-40");
    expect(html).toContain("if(kind!=='initial')return ''");
    expect(html).toContain("busy||control.hasAttribute('data-always-disabled')");
    expect(html).toContain("/scope");
    expect(html).toContain("Candidate promoted to the global guide.");
    expect(html).toContain("Candidate demoted to its project guide.");
  });
});
