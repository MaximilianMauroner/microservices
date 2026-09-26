import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("feedback copy UI", () => {
  it("mounts the shared toaster and keeps the primary copy button legible on hover", async () => {
    const [root, feedbackUi] = await Promise.all([
      readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8"),
      readFile(new URL("../feedback/ui.tsx", import.meta.url), "utf8"),
    ]);

    expect(root).toContain("<Toaster />");
    expect(feedbackUi).toContain('const primaryButton = buttonVariants({ size: "lg" });');
    expect(feedbackUi).toContain('copyFeedbackText(publicUrl, "Link copied")');
    expect(feedbackUi).toContain("<FeedbackQuestionEditor questions={questions} language={language} onChange={setQuestions} />");
  });

  it("renders the action-first mobile overview", async () => {
    const feedbackUi = await readFile(new URL("../feedback/ui.tsx", import.meta.url), "utf8");

    expect(feedbackUi).toContain('aria-label="Feedback overview"');
    expect(feedbackUi).toContain("Preview form");
    expect(feedbackUi).toContain("Total responses");
    expect(feedbackUi).toContain("Recent responses");
    expect(feedbackUi).toContain("Edit form");
    expect(feedbackUi).toContain("More tools");
    expect(feedbackUi).toContain('aria-controls="feedback-form-editor"');
    expect(feedbackUi).toContain('activePanel === "edit" ? "block" : "hidden"');
    expect(feedbackUi).toContain("Preview form");
    expect(feedbackUi).toContain("Additional context");
  });
});
