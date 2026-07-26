import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { reviewConsole } from "../src/ui.js";

async function renderReviewConsole(): Promise<string> {
  return (await request(express().get("/review", reviewConsole)).get("/review")).text;
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
});
