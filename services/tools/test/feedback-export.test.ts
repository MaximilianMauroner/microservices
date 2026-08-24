import { describe, expect, it } from "vitest";
import { feedbackCsv } from "../feedback/export.js";
import { DEFAULT_FEEDBACK_INTRODUCTION, DEFAULT_GERMAN_TRANSLATION, FEEDBACK_TEMPLATE, type FeedbackForm, type FeedbackSubmission } from "../feedback/domain.js";

const form: FeedbackForm = { id: "form", publicToken: "token", title: "Feedback", introduction: DEFAULT_FEEDBACK_INTRODUCTION, questions: FEEDBACK_TEMPLATE, translations: { de: DEFAULT_GERMAN_TRANSLATION }, status: "active", createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z", responseCount: 1, unreadCount: 1 };
const submission: FeedbackSubmission = { id: "response", formId: "form", formTitle: "Feedback", questionSnapshot: FEEDBACK_TEMPLATE, answers: { disliked: "=IMPORTXML(\"bad\")", enjoyed: "Walk, talk\nand tea" }, submittedAt: "2026-08-24T12:10:00.000Z", reviewState: "unread", followUpState: "none" };

describe("feedback CSV export", () => {
  it("quotes every cell and neutralizes spreadsheet formulas", () => {
    const csv = feedbackCsv(form, [submission]);
    expect(csv).toContain('"\'=IMPORTXML(""bad"")"');
    expect(csv).toContain('"Walk, talk\nand tea"');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
});
